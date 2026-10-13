import type { Motion, Packet } from '../protocol/pelcoD'
import { thermalPalettes } from './thermalPalettes'

export interface Pose { pan: number; tilt: number; zoom: number; focus: number; iris: number }
export interface CameraState extends Pose {
  power: boolean; scanning: boolean; motion: Motion; target: Pose | null
  presets: Map<number, Pose>; lastMotionAt: number; watchdogStopped: boolean
  zeroPan: number; autofocus: boolean
  thermalEnabled: boolean; thermalPalette: string; thermalInverted: boolean
  lampOn: boolean; lampArmedUntil: number
}
export interface CameraProfile {
  maxPanSpeed: number; turboPanSpeed: number; maxTiltSpeed: number
  minTilt: number; maxTilt: number; maxZoom: number; watchdogMs: number
}
export const defaultProfile: CameraProfile = { maxPanSpeed: 40, turboPanSpeed: 60, maxTiltSpeed: 20, minTilt: -90, maxTilt: 90, maxZoom: 30, watchdogMs: 15000 }
export const autoScanRate = 7.5
export const stoppedMotion = (): Motion => ({ pan: 0, tilt: 0, zoom: 0, focus: 0, iris: 0, panSpeed: 0, tiltSpeed: 0 })
export function createCamera(): CameraState {
  return { pan: 0, tilt: 0, zoom: 1, focus: 0.5, iris: 0.7, power: true, scanning: false, motion: stoppedMotion(), target: null, presets: new Map(), lastMotionAt: 0, watchdogStopped: false, zeroPan: 0, autofocus: true, thermalEnabled: false, thermalPalette: 'white-hot', thermalInverted: false, lampOn: false, lampArmedUntil: 0 }
}
const wrap = (angle: number) => ((angle % 360) + 360) % 360
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))
export const zoomSpeedFactor = (zoom: number) => 1 / Math.max(1, zoom)
export const panRate = (speed: number, profile: CameraProfile, zoom = 1) => (speed === 0x40 || speed === 0xff ? profile.turboPanSpeed : 0.05 + speed / 63 * (profile.maxPanSpeed - 0.05)) * zoomSpeedFactor(zoom)
export const tiltRate = (speed: number, profile: CameraProfile, zoom = 1) => (0.05 + speed / 63 * (profile.maxTiltSpeed - 0.05)) * zoomSpeedFactor(zoom)
export function cameraRates(camera: CameraState, profile: CameraProfile): { pan: number; tilt: number } {
  const factor = zoomSpeedFactor(camera.zoom)
  if (camera.target) {
    const panDelta = ((camera.target.pan - camera.pan + 540) % 360) - 180
    const tiltDelta = camera.target.tilt - camera.tilt
    return { pan: Math.abs(panDelta) < 0.001 ? 0 : Math.sign(panDelta) * profile.maxPanSpeed * factor, tilt: Math.abs(tiltDelta) < 0.001 ? 0 : Math.sign(tiltDelta) * profile.maxTiltSpeed * factor }
  }
  const atTiltLimit = camera.motion.tilt < 0 && camera.tilt <= profile.minTilt || camera.motion.tilt > 0 && camera.tilt >= profile.maxTilt
  return { pan: camera.scanning ? autoScanRate * factor : camera.motion.pan * panRate(camera.motion.panSpeed, profile, camera.zoom), tilt: atTiltLimit ? 0 : camera.motion.tilt * tiltRate(camera.motion.tiltSpeed, profile, camera.zoom) }
}
export function stopCamera(camera: CameraState) {
  camera.motion = stoppedMotion(); camera.scanning = false; camera.target = null
}
export function applyPacket(camera: CameraState, packet: Packet, now = Date.now()): string {
  if (!packet.valid) return 'Rejected'
  if (!packet.matches) return 'Other address'
  const command = packet.command
  if (camera.lampArmedUntil) {
    const lampValue = command?.type === 'preset' && command.action === 'call' && [3, 4].includes(command.preset)
    if (lampValue && now <= camera.lampArmedUntil) {
      camera.lampOn = command.preset === 4; camera.lampArmedUntil = 0
      packet.description = `IRIS lamp ${camera.lampOn ? 'on' : 'off'}`
      return 'Applied'
    }
    camera.lampArmedUntil = 0
  }
  if (!command || command.type === 'unsupported') return 'Not simulated'
  if (command.type === 'zero') { camera.zeroPan = camera.pan; return 'Applied' }
  if (command.type === 'autofocus') { camera.autofocus = command.enabled; if (command.enabled) camera.focus = 0.5; return 'Applied' }
  if (command.type === 'absolute') {
    const target = { ...(camera.target ?? { pan: camera.pan, tilt: camera.tilt, zoom: camera.zoom, focus: camera.focus, iris: camera.iris }) }
    target[command.axis] = command.axis === 'tilt' ? clamp(command.position, -90, 90) : command.position
    stopCamera(camera); camera.target = target
    return 'Applied'
  }
  if (command.type === 'motion') {
    camera.motion = { ...command.motion }; camera.target = null
    if (command.motion.focus) camera.autofocus = false
    camera.lastMotionAt = now; camera.watchdogStopped = false
    if (command.motion.power !== undefined) camera.power = command.motion.power
    if (command.motion.scan !== undefined) camera.scanning = command.motion.scan
    else if (command.motion.pan || command.motion.tilt || packet.description === 'Stop all motion') camera.scanning = false
    return 'Applied'
  }
  const { action, preset } = command
  if (action === 'call') {
    const palette = thermalPalettes.find(item => item.preset === preset)
    if (palette) { camera.thermalPalette = palette.id; camera.thermalEnabled = true; return 'Applied' }
    if (preset === 90) { camera.lampArmedUntil = now + 2000; return 'Lamp armed' }
    if (preset === 226 || preset === 229) { camera.thermalEnabled = preset === 229; return 'Applied' }
    if (preset === 253 || preset === 254) { camera.thermalInverted = preset === 253; return 'Applied' }
  }
  if (preset > 32) {
    if (action !== 'call' || (preset !== 33 && preset !== 34)) return 'Not simulated'
    stopCamera(camera)
    camera.target = { pan: preset === 33 ? wrap(camera.pan + 180) : 0, tilt: camera.tilt, zoom: camera.zoom, focus: camera.focus, iris: camera.iris }
    return 'Applied'
  }
  if (action === 'save') {
    camera.presets.set(preset, { pan: camera.pan, tilt: camera.tilt, zoom: camera.zoom, focus: camera.focus, iris: camera.iris })
    return 'Saved'
  }
  if (action === 'clear') { camera.presets.delete(preset); return 'Cleared' }
  const saved = camera.presets.get(preset)
  if (!saved) {
    packet.issues.push({ severity: 'warning', message: `Preset ${preset} has not been saved; this command is ignored.`, bytes: [5] })
    return 'No preset'
  }
  stopCamera(camera); camera.target = { ...saved }
  return 'Applied'
}
export function stepCamera(camera: CameraState, profile: CameraProfile, seconds: number, now = Date.now()): boolean {
  const moving = Object.entries(camera.motion).some(([key, value]) => ['pan', 'tilt', 'zoom', 'focus', 'iris'].includes(key) && Boolean(value))
  if (profile.watchdogMs > 0 && moving && now - camera.lastMotionAt >= profile.watchdogMs) {
    stopCamera(camera); camera.watchdogStopped = true; return true
  }
  const dt = Math.max(0, seconds)
  const zoomFactor = zoomSpeedFactor(camera.zoom)
  if (camera.target) {
    const target = camera.target
    const delta = ((target.pan - camera.pan + 540) % 360) - 180
    const travel = profile.maxPanSpeed * zoomFactor * dt
    camera.pan = wrap(camera.pan + clamp(delta, -travel, travel))
    camera.tilt += clamp(target.tilt - camera.tilt, -profile.maxTiltSpeed * zoomFactor * dt, profile.maxTiltSpeed * zoomFactor * dt)
    camera.zoom += clamp(target.zoom - camera.zoom, -2.5 * dt, 2.5 * dt)
    camera.focus += clamp(target.focus - camera.focus, -0.1 * dt, 0.1 * dt)
    camera.iris += clamp(target.iris - camera.iris, -0.1 * dt, 0.1 * dt)
    if (Math.abs(delta) <= travel && Math.abs(target.tilt - camera.tilt) < 0.001 && Math.abs(target.zoom - camera.zoom) < 0.001 && Math.abs(target.focus - camera.focus) < 0.001 && Math.abs(target.iris - camera.iris) < 0.001) camera.target = null
  } else {
    camera.pan = wrap(camera.pan + (camera.scanning ? autoScanRate * zoomFactor : camera.motion.pan * panRate(camera.motion.panSpeed, profile, camera.zoom)) * dt)
    camera.tilt = clamp(camera.tilt + camera.motion.tilt * tiltRate(camera.motion.tiltSpeed, profile, camera.zoom) * dt, profile.minTilt, profile.maxTilt)
    camera.zoom = clamp(camera.zoom + camera.motion.zoom * 2.5 * dt, 1, profile.maxZoom)
    camera.focus = clamp(camera.focus + camera.motion.focus * 0.1 * dt, 0, 1)
    camera.iris = clamp(camera.iris + camera.motion.iris * 0.1 * dt, 0, 1)
  }
  return false
}

import type { Motion, Packet } from '../protocol/pelcoD'

export interface Pose { pan: number; tilt: number; zoom: number; focus: number; iris: number }
export interface CameraState extends Pose {
  power: boolean; scanning: boolean; motion: Motion; target: Pose | null
  presets: Map<number, Pose>; lastMotionAt: number; watchdogStopped: boolean
  zeroPan: number; autofocus: boolean
}
export interface CameraProfile {
  maxPanSpeed: number; turboPanSpeed: number; maxTiltSpeed: number
  minTilt: number; maxTilt: number; maxZoom: number; watchdogMs: number
}
export const defaultProfile: CameraProfile = { maxPanSpeed: 80, turboPanSpeed: 120, maxTiltSpeed: 40, minTilt: -90, maxTilt: 90, maxZoom: 30, watchdogMs: 15000 }
export const stoppedMotion = (): Motion => ({ pan: 0, tilt: 0, zoom: 0, focus: 0, iris: 0, panSpeed: 0, tiltSpeed: 0 })
export function createCamera(): CameraState {
  return { pan: 0, tilt: 0, zoom: 1, focus: 0.5, iris: 0.7, power: true, scanning: false, motion: stoppedMotion(), target: null, presets: new Map(), lastMotionAt: 0, watchdogStopped: false, zeroPan: 0, autofocus: true }
}
const wrap = (angle: number) => ((angle % 360) + 360) % 360
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))
export const panRate = (speed: number, profile: CameraProfile) => speed === 0x40 || speed === 0xff ? profile.turboPanSpeed : 0.1 + speed / 63 * (profile.maxPanSpeed - 0.1)
export const tiltRate = (speed: number, profile: CameraProfile) => 0.1 + speed / 63 * (profile.maxTiltSpeed - 0.1)
export function stopCamera(camera: CameraState) {
  camera.motion = stoppedMotion(); camera.scanning = false; camera.target = null
}
export function applyPacket(camera: CameraState, packet: Packet, now = Date.now()): string {
  if (!packet.valid) return 'Rejected'
  if (!packet.matches) return 'Other address'
  const command = packet.command
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
  if (camera.target) {
    const target = camera.target
    const delta = ((target.pan - camera.pan + 540) % 360) - 180
    const travel = profile.maxPanSpeed * dt
    camera.pan = wrap(camera.pan + clamp(delta, -travel, travel))
    camera.tilt += clamp(target.tilt - camera.tilt, -profile.maxTiltSpeed * dt, profile.maxTiltSpeed * dt)
    camera.zoom += clamp(target.zoom - camera.zoom, -5 * dt, 5 * dt)
    camera.focus += clamp(target.focus - camera.focus, -0.2 * dt, 0.2 * dt)
    camera.iris += clamp(target.iris - camera.iris, -0.2 * dt, 0.2 * dt)
    if (Math.abs(delta) <= travel && Math.abs(target.tilt - camera.tilt) < 0.001 && Math.abs(target.zoom - camera.zoom) < 0.001 && Math.abs(target.focus - camera.focus) < 0.001 && Math.abs(target.iris - camera.iris) < 0.001) camera.target = null
  } else {
    camera.pan = wrap(camera.pan + (camera.scanning ? 15 : camera.motion.pan * panRate(camera.motion.panSpeed, profile)) * dt)
    camera.tilt = clamp(camera.tilt + camera.motion.tilt * tiltRate(camera.motion.tiltSpeed, profile) * dt, profile.minTilt, profile.maxTilt)
    camera.zoom = clamp(camera.zoom + camera.motion.zoom * 5 * dt, 1, profile.maxZoom)
    camera.focus = clamp(camera.focus + camera.motion.focus * 0.2 * dt, 0, 1)
    camera.iris = clamp(camera.iris + camera.motion.iris * 0.2 * dt, 0, 1)
  }
  return false
}

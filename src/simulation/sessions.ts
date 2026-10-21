import type { CameraProfile, CameraState, Pose } from './camera'
import type { CameraConfig } from './cameras'
import type { NvrConfig, NvrState } from './nvr'
import type { Switcher } from './switcher'
import type { SceneEnvironment, TimeOfDay } from './environment'
import type { ThermalSettings } from './thermal'

export interface StreamSnapshot { buffer: number[]; lastByteAt: number }
export interface SessionSnapshot {
  now: number; seconds: number
  cameras: (CameraConfig & { state: Omit<CameraState, 'presets'> & { presets: [number, Pose][] } })[]
  switchers: Switcher[]; config: NvrConfig; profile: CameraProfile
  nvr: Omit<NvrState, 'heldKeys'> & { heldKeys: [string, number][] }
  environment: SceneEnvironment; timeOfDay: TimeOfDay; waves: number; thermal: ThermalSettings
  cameraId: string; baud: number; turbo: number; nvrInputBaud: number | null
  bus: StreamSnapshot & { source: string }; nvrStream: StreamSnapshot; nvrSource: string; nvrCommandId?: string
}
export type SessionEvent = { at: number } & (
  { type: 'bytes'; line: 'camera' | 'nvr'; bytes: number[]; source: string; complete: boolean; commandId?: string; baud?: number | null }
  | { type: 'state'; snapshot: SessionSnapshot; label: string }
)
export interface RecordedSession { format: 'iris-session'; version: 1; id: string; name: string; createdAt: string; duration: number; initial: SessionSnapshot; events: SessionEvent[] }
export const sessionStorageKey = 'iris_simulators_sessions_v1'
export const maxSessionEvents = 50000
export const maxSessionDuration = 2 * 60 * 60 * 1000

// Reject malformed imports before they can reach device state or the renderer.
export function parseSession(text: string): RecordedSession {
  if (text.length > 12_000_000) throw new Error('Session files must be smaller than 12 MB.')
  const value = JSON.parse(text)
  const finiteTree = (item: unknown): boolean => typeof item === 'number' ? Number.isFinite(item) : Array.isArray(item) ? item.every(finiteTree) : item !== null && typeof item === 'object' ? Object.entries(item).every(([key, child]) => !['__proto__', 'constructor', 'prototype'].includes(key) && finiteTree(child)) : true
  const number = (item: unknown, low: number, high: number): item is number => typeof item === 'number' && Number.isFinite(item) && item >= low && item <= high
  const string = (item: unknown, max = 160): item is string => typeof item === 'string' && item.length <= max
  const bytes = (item: unknown) => Array.isArray(item) && item.length <= 65536 && item.every(byte => number(byte, 0, 255) && Number.isInteger(byte))
  const pose = (item: any) => item && number(item.pan, 0, 360) && number(item.tilt, -90, 90) && number(item.zoom, 1, 30) && number(item.focus, 0, 1) && number(item.iris, 0, 1)
  const stream = (item: any, max: number) => item && bytes(item.buffer) && item.buffer.length < max && number(item.lastByteAt, 0, 1e15)
  function snapshot(item: any): boolean {
    if (!item || !number(item.now, 0, 1e15) || !number(item.seconds, 0, 1e10) || !Array.isArray(item.cameras) || item.cameras.length < 1 || item.cameras.length > 8) return false
    const ids = new Set<string>()
    for (const camera of item.cameras) {
      const state = camera?.state
      if (!string(camera?.id, 80) || !camera.id || ids.has(camera.id) || !string(camera.name, 80) || !number(camera.address, 1, 255) || !number(camera.baudRate, 1, 230400) || !pose(state)) return false
      ids.add(camera.id)
      if (!state.motion || !['pan', 'tilt', 'zoom', 'focus', 'iris'].every(key => number(state.motion[key], -1, 1)) || !number(state.motion.panSpeed, 0, 255) || !number(state.motion.tiltSpeed, 0, 63)) return false
      if (!['power', 'scanning', 'autofocus', 'thermalEnabled', 'thermalInverted', 'lampOn', 'gyroOn', 'watchdogStopped'].every(key => typeof state[key] === 'boolean')) return false
      if (!['lastMotionAt', 'lampArmedUntil', 'gyroStartedAt', 'zeroPan', 'gyroTrim'].every(key => number(state[key], -1e15, 1e15)) || !string(state.thermalPalette, 40) || state.target !== null && !pose(state.target)) return false
      if (!Array.isArray(state.presets) || state.presets.length > 32 || !state.presets.every((entry: any) => Array.isArray(entry) && number(entry[0], 1, 32) && pose(entry[1]))) return false
    }
    if (!Array.isArray(item.switchers) || item.switchers.length > 32 || !item.switchers.every((device: any) => device && string(device.id) && string(device.name) && typeof device.enabled === 'boolean' && number(device.address, 1, 255) && number(device.baudRate, 1, 230400) && number(device.updatedAt, 0, 1e15) && Array.isArray(device.inputs) && device.inputs.length <= 255 && device.inputs.every((name: unknown) => string(name)) && Array.isArray(device.outputs) && device.outputs.length <= 255 && device.outputs.every((name: unknown) => string(name)) && device.routes && Object.entries(device.routes).every(([key, route]) => number(Number(key), 1, 255) && number(route, 1, 255)) && (!device.inputSources || Object.values(device.inputSources).every((source: any) => source && ['camera', 'nvr', 'radar', 'streaming', 'none'].includes(source.type) && (source.type !== 'camera' || string(source.cameraId, 80)))))) return false
    const nvr = item.nvr; const config = item.config; const profile = item.profile; const thermal = item.thermal
    return Boolean(nvr && number(nvr.channel, 0, 32) && [1, 4, 8, 16].includes(nvr.layout) && Array.isArray(nvr.heldKeys) && nvr.heldKeys.length <= 32 && nvr.heldKeys.every((entry: any) => Array.isArray(entry) && string(entry[0], 20) && number(entry[1], 0, 1e15)) && number(nvr.lastDigitAt, 0, 1e15) && (nvr.lastDigit === undefined || number(nvr.lastDigit, 0, 9))
      && config && string(config.name, 80) && number(config.baudRate, 1, 230400) && config.channels && Object.entries(config.channels).every(([key, id]) => number(Number(key), 1, 32) && string(id, 80))
      && profile && ['maxPanSpeed', 'turboPanSpeed', 'maxTiltSpeed'].every(key => number(profile[key], 0, 360)) && number(profile.minTilt, -90, 90) && number(profile.maxTilt, profile.minTilt, 90) && number(profile.maxZoom, 1, 30) && number(profile.watchdogMs, 0, 60000)
      && thermal && number(thermal.min, -40, 199) && number(thermal.max, thermal.min + 1, 200) && number(thermal.air, -20, 50) && number(thermal.water, -2, 40)
      && ['yacht', 'vista'].includes(item.environment) && ['day', 'golden-hour', 'night'].includes(item.timeOfDay) && number(item.waves, 0, 2) && string(item.cameraId, 80) && ids.has(item.cameraId) && number(item.baud, 1, 230400) && [64, 255].includes(item.turbo) && (item.nvrInputBaud === null || number(item.nvrInputBaud, 1, 230400))
      && stream(item.bus, 7) && string(item.bus.source) && stream(item.nvrStream, 4) && string(item.nvrSource) && (item.nvrCommandId === undefined || string(item.nvrCommandId)))
  }
  if (!finiteTree(value) || value?.format !== 'iris-session' || value.version !== 1 || !string(value.id, 80) || !value.id || !string(value.name, 80) || !value.name.trim() || !string(value.createdAt, 40) || !number(value.duration, 0, maxSessionDuration) || !snapshot(value.initial) || !Array.isArray(value.events) || value.events.length > maxSessionEvents) throw new Error('This is not a valid IRIS session recording.')
  let previous = 0
  for (const event of value.events) {
    if (!event || !number(event.at, previous, value.duration) || (event.type === 'state' ? !snapshot(event.snapshot) || !string(event.label) : event.type !== 'bytes' || !['camera', 'nvr'].includes(event.line) || !bytes(event.bytes) || !string(event.source) || typeof event.complete !== 'boolean' || event.commandId !== undefined && !string(event.commandId) || event.baud !== undefined && event.baud !== null && !number(event.baud, 1, 230400))) throw new Error('The recording contains an invalid event or timeline.')
    previous = event.at
  }
  return value
}

export class SessionPlayback {
  position = 0
  private cursor = 0
  constructor(readonly session: RecordedSession, private hooks: { restore: (snapshot: SessionSnapshot) => void; advance: (ms: number) => void; event: (event: SessionEvent) => void }) {}
  seek(milliseconds: number) {
    this.position = 0; this.cursor = 0; this.hooks.restore(this.session.initial)
    this.advance(milliseconds)
  }
  advance(milliseconds: number) {
    const end = Math.min(this.session.duration, Math.max(this.position, this.position + milliseconds))
    while (this.cursor < this.session.events.length && this.session.events[this.cursor]!.at <= end) {
      const event = this.session.events[this.cursor++]!
      this.hooks.advance(event.at - this.position); this.position = event.at; this.hooks.event(event)
    }
    this.hooks.advance(end - this.position); this.position = end
  }
}

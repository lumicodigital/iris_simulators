import type { NvrPacket } from '../protocol/nvr'
import type { CameraConfig, SimulatedCamera } from './cameras'
import { baudRates } from './switcher'
import { createDefaultNvrConfig, defaultCameras } from './defaults'

export type NvrLayout = 1 | 4 | 8 | 16
export interface NvrConfig { name: string; baudRate: number; channels: Record<number, string> }
export interface NvrState { channel: number; layout: NvrLayout; heldKeys: Map<string, number>; lastDigit?: number; lastDigitAt: number }
export const nvrStorageKey = 'iris_simulators_nvr_v1'
export function createNvr(): NvrState { return { channel: 1, layout: 1, heldKeys: new Map(), lastDigitAt: 0 } }
export function loadNvrConfig(cameras: readonly CameraConfig[] = defaultCameras): NvrConfig {
  const fallback = createDefaultNvrConfig(cameras)
  try {
    const item = JSON.parse(localStorage.getItem(nvrStorageKey) ?? 'null') as Partial<NvrConfig> | null
    if (!item || typeof item !== 'object') return fallback
    const channels: Record<number, string> = {}
    if (item.channels && typeof item.channels === 'object') for (const [key, value] of Object.entries(item.channels)) {
      if (Number.isInteger(Number(key)) && Number(key) >= 1 && Number(key) <= 32 && typeof value === 'string') channels[Number(key)] = value.slice(0, 80)
    }
    return { name: typeof item.name === 'string' && item.name.trim() ? item.name.trim().slice(0, 80) : fallback.name, baudRate: baudRates.includes(item.baudRate ?? 0) ? item.baudRate! : 9600, channels }
  } catch { return fallback }
}
export function nvrCamera(config: NvrConfig, cameras: readonly SimulatedCamera[], channel: number): SimulatedCamera | undefined {
  const id = Object.hasOwn(config.channels, channel) ? config.channels[channel] : cameras[channel - 1]?.id
  return cameras.find(item => item.id === id)
}
export function nvrChannels(state: NvrState): number[] {
  const first = state.layout === 1 ? state.channel : Math.floor((Math.max(1, state.channel) - 1) / state.layout) * state.layout + 1
  return Array.from({ length: state.layout }, (_, i) => first + i)
}
export function applyNvrPacket(state: NvrState, packet: NvrPacket, now = Date.now(), groupedCommand = false): string {
  if (!packet.valid) return 'Rejected'
  if (!packet.pressed) { state.heldKeys.delete(packet.key); return 'Released' }
  const heldAt = state.heldKeys.get(packet.key)
  if (heldAt !== undefined && now - heldAt < 2000) {
    packet.issues.push({ severity: 'info', message: 'Repeated held key ignored until release.', bytes: [3] }); return 'Ignored'
  }
  state.heldKeys.set(packet.key, now)
  if (packet.split) {
    state.lastDigit = undefined
    state.layout = ({ 1: 4, 4: 8, 8: 16, 16: 1 } as const)[state.layout]
    packet.description = state.layout === 1 ? `NVR fullscreen · channel ${state.channel}` : `NVR ${state.layout}-way split`
    return 'Applied'
  }
  if (packet.digit !== undefined) {
    // IRIS select_channel encodes 10–32 as [tens - 1, units].
    const combined = state.lastDigit !== undefined && state.lastDigit <= 2 && (groupedCommand || now - state.lastDigitAt < 500) ? 10 + state.lastDigit * 10 + packet.digit : undefined
    state.channel = combined !== undefined && combined <= 32 ? combined : packet.digit
    state.lastDigit = combined !== undefined && combined <= 32 ? undefined : packet.digit
    state.lastDigitAt = now; state.layout = 1
    packet.description = `NVR select channel ${state.channel} · fullscreen`
    return 'Applied'
  }
  state.lastDigit = undefined
  return 'Ignored'
}

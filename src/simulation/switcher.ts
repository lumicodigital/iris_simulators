import { defaultCameras, defaultSwitcher } from './defaults'

export type VideoSource = { type: 'nvr' | 'radar' | 'streaming' } | { type: 'camera'; cameraId: string } | { type: 'none' }
export interface Switcher {
  id: string; name: string; address: number; baudRate: number; enabled: boolean
  inputs: string[]; outputs: string[]; routes: Record<number, number>; updatedAt: number
  inputSources?: Record<number, VideoSource>
}
export const switcherStorageKey = 'iris_simulators_switchers_v1'
export const baudRates = [2400, 4800, 9600, 19200, 38400, 57600, 115200]
export const maxPorts = 255
export function createSwitcher(address = defaultSwitcher.address, cameraId = defaultCameras[0].id): Switcher {
  const setup = structuredClone(defaultSwitcher)
  setup.inputSources![2] = { type: 'camera', cameraId }
  return { ...setup, id: crypto.randomUUID(), address, updatedAt: 0 }
}
export function normalizeSwitcher(value: unknown): Switcher | undefined {
  if (!value || typeof value !== 'object') return
  const item = value as Partial<Switcher>
  if (!Number.isInteger(item.address) || item.address! < 201 || item.address! > 255) return
  if (!Array.isArray(item.inputs) || !Array.isArray(item.outputs) || !item.inputs.length || !item.outputs.length || item.inputs.length > maxPorts || item.outputs.length > maxPorts) return
  const names = (values: unknown[], prefix: string) => values.map((name, index) => typeof name === 'string' && name.trim() ? name.trim().slice(0, 80) : `${prefix} ${index + 1}`)
  const inputs = names(item.inputs, 'Input'); const outputs = names(item.outputs, 'Monitor')
  const routes: Record<number, number> = {}
  const inputSources: Record<number, VideoSource> = {}
  if (item.inputSources && typeof item.inputSources === 'object') for (const [port, source] of Object.entries(item.inputSources)) {
    if (!Number.isInteger(Number(port)) || Number(port) < 1 || Number(port) > inputs.length || !source || typeof source !== 'object') continue
    if (source.type === 'nvr' || source.type === 'none' || source.type === 'radar' || source.type === 'streaming') inputSources[Number(port)] = { type: source.type }
    else if (source.type === 'camera' && typeof source.cameraId === 'string') inputSources[Number(port)] = { type: 'camera', cameraId: source.cameraId.slice(0, 80) }
  }
  if (item.routes && typeof item.routes === 'object') {
    for (const [output, input] of Object.entries(item.routes)) {
      if (Number.isInteger(Number(output)) && Number(output) >= 1 && Number(output) <= outputs.length && Number.isInteger(input) && input >= 1 && input <= inputs.length) routes[Number(output)] = input
    }
  }
  return { id: typeof item.id === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(item.id) ? item.id : crypto.randomUUID(), name: typeof item.name === 'string' && item.name.trim() ? item.name.trim().slice(0, 80) : 'Monitor switcher', address: item.address!, baudRate: baudRates.includes(item.baudRate ?? 0) ? item.baudRate! : 9600, enabled: item.enabled !== false, inputs, outputs, routes, updatedAt: Number.isFinite(item.updatedAt) ? item.updatedAt! : 0, inputSources }
}
export function loadSwitchers(cameraId = defaultCameras[0].id): Switcher[] {
  try {
    const saved = localStorage.getItem(switcherStorageKey)
    if (saved === null) return [createSwitcher(undefined, cameraId)]
    const parsed: unknown = JSON.parse(saved)
    if (!Array.isArray(parsed)) return [createSwitcher(undefined, cameraId)]
    const devices = parsed.slice(0, 32).map(normalizeSwitcher).filter((device): device is Switcher => Boolean(device))
    const ids = new Set<string>()
    for (const device of devices) { if (ids.has(device.id)) device.id = crypto.randomUUID(); ids.add(device.id) }
    return devices
  } catch { return [createSwitcher(undefined, cameraId)] }
}

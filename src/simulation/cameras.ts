import { createCamera, type CameraState } from './camera'
import { baudRates } from './switcher'
import { defaultCameras } from './defaults'

export interface CameraConfig { id: string; name: string; address: number; baudRate: number }
export interface SimulatedCamera extends CameraConfig { state: CameraState }
export const maxCameras = 4
export const cameraStorageKey = 'iris_simulators_cameras_v1'
export function createSimulatedCamera(address = 1, name = 'PTZ camera', id: string = crypto.randomUUID()): SimulatedCamera {
  return { id, name, address, baudRate: 9600, state: createCamera() }
}
export function createDefaultCameras(): SimulatedCamera[] { return defaultCameras.map(config => ({ ...config, state: createCamera() })) }
export function normalizeCameraConfig(value: unknown): CameraConfig | undefined {
  if (!value || typeof value !== 'object') return
  const item = value as Partial<CameraConfig>
  if (!Number.isInteger(item.address) || item.address! < 1 || item.address! > 255) return
  return { id: typeof item.id === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(item.id) ? item.id : crypto.randomUUID(), name: typeof item.name === 'string' && item.name.trim() ? item.name.trim().slice(0, 80) : 'PTZ camera', address: item.address!, baudRate: baudRates.includes(item.baudRate ?? 0) ? item.baudRate! : 9600 }
}
export function loadCameras(): SimulatedCamera[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(cameraStorageKey) ?? 'null')
    if (Array.isArray(saved)) {
      const configs = saved.slice(0, maxCameras).map(normalizeCameraConfig).filter((item): item is CameraConfig => Boolean(item))
      const ids = new Set<string>()
      for (const item of configs) { if (ids.has(item.id)) item.id = crypto.randomUUID(); ids.add(item.id) }
      if (configs.length) return configs.map(item => ({ ...item, state: createCamera() }))
    }
  } catch { /* Browser storage may be unavailable. Use the default setup. */ }
  return createDefaultCameras()
}

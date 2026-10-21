import { createCamera, type CameraState } from './camera'
import { baudRates } from './switcher'
import { defaultCameras } from './defaults'
import { isYachtMount, yachtMounts, type YachtMountId } from './environment'

export interface CameraConfig { id: string; name: string; address: number; baudRate: number; yachtMount?: YachtMountId }
export interface SimulatedCamera extends CameraConfig { state: CameraState }
export const maxCameras = 8
export const cameraStorageKey = 'iris_simulators_cameras_v1'
export function createSimulatedCamera(address = 1, name = 'PTZ camera', id: string = crypto.randomUUID()): SimulatedCamera {
  return { id, name, address, baudRate: 9600, state: createCamera() }
}
export function createDefaultCameras(): SimulatedCamera[] { return defaultCameras.map(config => ({ ...config, state: createCamera() })) }
export function normalizeCameraConfig(value: unknown): CameraConfig | undefined {
  if (!value || typeof value !== 'object') return
  const item = value as Partial<CameraConfig>
  if (!Number.isInteger(item.address) || item.address! < 1 || item.address! > 255) return
  return { id: typeof item.id === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(item.id) ? item.id : crypto.randomUUID(), name: typeof item.name === 'string' && item.name.trim() ? item.name.trim().slice(0, 80) : 'PTZ camera', address: item.address!, baudRate: baudRates.includes(item.baudRate ?? 0) ? item.baudRate! : 9600, yachtMount: isYachtMount(item.yachtMount) ? item.yachtMount : undefined }
}
export function completeYachtCameras(cameras: readonly CameraConfig[], occupiedAddresses: readonly number[] = []): CameraConfig[] {
  const usedMounts = new Set(cameras.flatMap(camera => camera.yachtMount ? [camera.yachtMount] : []))
  const configs = cameras.map(camera => {
    const mount = camera.yachtMount ?? yachtMounts.find(item => !usedMounts.has(item.id))?.id
    if (mount) usedMounts.add(mount)
    return { id: camera.id, name: camera.name, address: camera.address, baudRate: camera.baudRate, yachtMount: mount }
  })
  const addresses = new Set([...occupiedAddresses, ...configs.map(camera => camera.address)])
  for (const mount of yachtMounts) {
    if (usedMounts.has(mount.id) || configs.length >= maxCameras) continue
    const address = Array.from({ length: 255 }, (_, i) => i + 1).find(value => !addresses.has(value))
    if (!address) break
    addresses.add(address)
    configs.push({ id: crypto.randomUUID(), name: mount.name, address, baudRate: cameras[0]?.baudRate ?? 9600, yachtMount: mount.id })
  }
  return configs
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

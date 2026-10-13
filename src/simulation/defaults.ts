import type { CameraConfig } from './cameras'
import type { NvrConfig } from './nvr'
import type { Switcher } from './switcher'

// Shared by first-time startup and Reset to default.
export const defaultCameras: CameraConfig[] = [
  { id: 'camera', name: 'PTZ camera', address: 1, baudRate: 9600 },
  { id: 'camera-2', name: 'Camera 2', address: 2, baudRate: 9600 },
  { id: 'camera-3', name: 'Camera 3', address: 3, baudRate: 9600 },
  { id: 'camera-4', name: 'Camera 4', address: 4, baudRate: 9600 },
]

export const defaultSwitcher: Omit<Switcher, 'id' | 'updatedAt'> = {
  name: 'Bridge video switcher', address: 202, baudRate: 9600, enabled: true,
  inputs: ['NVR output', 'Camera 1 direct', 'Radar / chart plotter', 'Movie streaming'],
  outputs: ['Main display', 'Camera monitor', 'Navigation display', 'Salon TV'],
  routes: { 1: 1, 2: 2, 3: 3, 4: 4 },
  inputSources: { 1: { type: 'nvr' }, 2: { type: 'camera', cameraId: defaultCameras[0].id }, 3: { type: 'radar' }, 4: { type: 'streaming' } },
}

export function createDefaultNvrConfig(cameras: readonly CameraConfig[] = defaultCameras): NvrConfig {
  return { name: 'IRIS NVR', baudRate: 9600, channels: Object.fromEntries(cameras.map((camera, i) => [i + 1, camera.id])) }
}

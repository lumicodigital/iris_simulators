import type { SimulatedCamera } from './cameras'
import type { Switcher, VideoSource } from './switcher'

export interface MonitorOutput { key: string; name: string; switcherId: string; switcherName: string; address: number; output: number; input?: number; inputName: string; source: VideoSource; reason: string }
export function inputSource(device: Switcher, input: number, cameras: readonly SimulatedCamera[]): VideoSource {
  const configured = device.inputSources?.[input]
  if (configured) return configured
  const name = device.inputs[input - 1]?.trim().toLowerCase()
  if (!name) return { type: 'none' }
  if (/nvr|recorder/.test(name)) return { type: 'nvr' }
  if (/radar|chart.?plotter/.test(name)) return { type: 'radar' }
  if (/streaming|netflix|movie/.test(name)) return { type: 'streaming' }
  if (/camera\s*1\b|direct camera/.test(name) && cameras[0]) return { type: 'camera', cameraId: cameras[0].id }
  const namedCamera = cameras.find(item => item.name.trim().toLowerCase() === name)
  if (namedCamera) return { type: 'camera', cameraId: namedCamera.id }
  if (device.inputs.length > 1 && input === device.inputs.length) return { type: 'nvr' }
  return cameras[input - 1] ? { type: 'camera', cameraId: cameras[input - 1].id } : { type: 'none' }
}
export function monitorOutputs(devices: readonly Switcher[], cameras: readonly SimulatedCamera[]): MonitorOutput[] {
  return devices.flatMap(device => device.outputs.map((name, index) => {
    const input = device.routes[index + 1]
    const source = device.enabled && input ? inputSource(device, input, cameras) : { type: 'none' } as const
    const reason = !device.enabled ? 'Switcher disabled' : !input ? 'No route received' : source.type === 'none' ? 'Input has no video source' : source.type === 'camera' && !cameras.some(item => item.id === source.cameraId) ? 'Camera is not configured' : ''
    return { key: `${device.id}:${index + 1}`, name, switcherId: device.id, switcherName: device.name, address: device.address, output: index + 1, input, inputName: input ? device.inputs[input - 1] ?? '' : '', source, reason }
  }))
}

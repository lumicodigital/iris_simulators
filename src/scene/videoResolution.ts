import type { SimulatedCamera } from '../simulation/cameras'
import { nvrCamera, nvrChannels, type NvrConfig, type NvrState } from '../simulation/nvr'
import type { MonitorOutput } from '../simulation/videoRouting'

export interface VideoSize { width: number; height: number }
export interface CameraVideoRequest extends VideoSize { highQuality: boolean }
export interface MonitorVideoTarget { output: MonitorOutput; size: VideoSize; fullscreen: boolean }
export const baseVideoSize: VideoSize = { width: 1280, height: 720 }

// Match the displayed 16:9 picture in physical pixels, up to 4K. The same DPR
// limit as the POV prevents retina screens from silently using tiny previews.
export function videoSizeForDisplay(width: number, height: number, pixelRatio = 1): VideoSize {
  const ratio = Number.isFinite(pixelRatio) && pixelRatio > 0 ? Math.min(pixelRatio, 2) : 1
  const fitted = Math.min(width, height * 16 / 9) * ratio
  const pixels = Number.isFinite(fitted) && fitted > 0 ? Math.min(3840, fitted) : 640
  return { width: Math.max(2, Math.round(pixels)), height: Math.max(1, Math.round(pixels * 9 / 16)) }
}

export function nvrCells(state: NvrState, size = baseVideoSize) {
  const columns = state.layout === 1 ? 1 : state.layout === 4 ? 2 : 4
  const rows = state.layout / columns
  const width = 1280 / columns; const height = 678 / rows
  const sx = size.width / 1280; const sy = size.height / 720
  return nvrChannels(state).map((channel, index) => ({ channel,
    x: (index % columns * width + 2) * sx, y: (42 + Math.floor(index / columns) * height + 2) * sy,
    width: (width - 4) * sx, height: (height - 4) * sy,
  }))
}

export function monitorVideoPlan(targets: MonitorVideoTarget[], state: NvrState, config: NvrConfig, cameras: readonly SimulatedCamera[]) {
  const requests: Record<string, CameraVideoRequest> = {}
  const sources: Partial<Record<'radar' | 'streaming', VideoSize>> = {}
  let nvr: VideoSize | undefined
  let focusedNvr = false
  function request(camera: SimulatedCamera | undefined, size: VideoSize, focused: boolean) {
    if (!camera?.state.power) return
    const previous = requests[camera.id]
    requests[camera.id] = {
      ...(!previous || size.width > previous.width ? size : previous),
      highQuality: Boolean(previous?.highQuality || focused || size.width >= 1280),
    }
  }
  for (const { output, size, fullscreen } of targets) {
    const source = output.source
    if (source.type === 'nvr') {
      if (!nvr || size.width > nvr.width) nvr = size
      focusedNvr ||= fullscreen
    } else if (source.type === 'camera') request(cameras.find(camera => camera.id === source.cameraId), size, fullscreen)
    else if (source.type === 'radar' || source.type === 'streaming') {
      if (!sources[source.type] || size.width > sources[source.type]!.width) sources[source.type] = size
    }
  }
  if (nvr) for (const cell of nvrCells(state, nvr)) {
    request(nvrCamera(config, cameras, cell.channel), videoSizeForDisplay(cell.width, cell.height), focusedNvr && state.layout === 1)
  }
  return { cameras: requests, nvr, sources }
}

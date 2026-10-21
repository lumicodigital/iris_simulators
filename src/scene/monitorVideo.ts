import type { SimulatedCamera } from '../simulation/cameras'
import { nvrCamera, type NvrConfig, type NvrState } from '../simulation/nvr'
import type { MonitorOutput } from '../simulation/videoRouting'
import { drawRadar, drawStreaming } from './displaySources'
import type { SceneEnvironment } from '../simulation/environment'
import { simulationClock } from '../simulation/clock'
import { thermalSettings } from '../simulation/thermal'
import { findPalette } from '../simulation/thermalPalettes'
import { baseVideoSize, nvrCells, type VideoSize } from './videoResolution'

export function createMonitorVideo() {
  const frames = new Map<string, HTMLCanvasElement>()
  const program = document.createElement('canvas')
  program.width = 1280; program.height = 720
  const sources = new Map((['radar', 'streaming'] as const).map(type => { const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 720; return [type, canvas] as const }))
  function renderSources(environment: SceneEnvironment = 'yacht', sizes: Partial<Record<'radar' | 'streaming', VideoSize>> = { radar: baseVideoSize, streaming: baseVideoSize }) {
    const now = simulationClock.seconds
    for (const [type, canvas] of sources) {
      const size = sizes[type]
      if (!size) { resize(canvas, { width: 1, height: 1 }); continue }
      resize(canvas, size)
      const ctx = canvas.getContext('2d')!; ctx.save(); ctx.scale(canvas.width / 1280, canvas.height / 720)
      if (type === 'radar') drawRadar(ctx, now, environment)
      else drawStreaming(ctx, now)
      ctx.restore()
    }
  }
  function resize(canvas: HTMLCanvasElement, size: VideoSize) {
    if (canvas.width !== size.width || canvas.height !== size.height) { canvas.width = size.width; canvas.height = size.height }
  }
  function retainCameras(ids: string[]) {
    const active = new Set(ids)
    for (const [id, canvas] of frames) if (!active.has(id)) { resize(canvas, { width: 1, height: 1 }); frames.delete(id) }
  }
  function capture(id: string, frame: HTMLCanvasElement) {
    let canvas = frames.get(id)
    if (!canvas) { canvas = document.createElement('canvas'); frames.set(id, canvas) }
    if (canvas.width !== frame.width || canvas.height !== frame.height) { canvas.width = frame.width; canvas.height = frame.height }
    // Copy during the WebGL render callback, before its drawing buffer is cleared.
    canvas.getContext('2d')?.drawImage(frame, 0, 0)
  }
  function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size = 16, color = '#abc1cb') {
    ctx.font = `500 ${size}px ui-monospace, monospace`; ctx.fillStyle = color
    ctx.fillText(text, x, y)
  }
  function feed(ctx: CanvasRenderingContext2D, camera: SimulatedCamera | undefined, x: number, y: number, w: number, h: number, title: string) {
    ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip()
    ctx.fillStyle = '#080e14'; ctx.fillRect(x, y, w, h)
    const image = camera?.state.power ? frames.get(camera.id) : undefined
    if (image) {
      const scale = Math.min(w / image.width, h / image.height)
      const dw = image.width * scale; const dh = image.height * scale
      ctx.drawImage(image, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh)
    } else {
      ctx.textAlign = 'center'
      label(ctx, camera?.state.power === false ? 'CAMERA OFF' : camera ? 'CONNECTING VIDEO' : 'NO SIGNAL', x + w / 2, y + h / 2, Math.max(12, Math.min(22, w / 20)), '#526879')
      ctx.textAlign = 'left'
    }
    if (image && camera?.state.thermalEnabled && w >= 160) {
      const height = Math.min(h * 0.4, 150); const left = x + w - 70; const top = y + 20
      ctx.fillStyle = '#041017c9'; ctx.fillRect(left - 8, top - 16, 68, height + 47)
      const gradient = ctx.createLinearGradient(0, top + height, 0, top)
      for (const [position, color] of findPalette(camera.state.thermalPalette).stops) gradient.addColorStop(camera.state.thermalInverted ? 1 - position : position, color)
      ctx.fillStyle = gradient; ctx.fillRect(left, top, 12, height)
      label(ctx, `${thermalSettings.max}°`, left + 18, top + 9, 12)
      label(ctx, `${thermalSettings.min}°`, left + 18, top + height, 12)
      label(ctx, 'SIM °C', left - 1, top + height + 20, 11, '#8babb8')
    }
    const fontSize = Math.max(20, Math.min(30, w / 16))
    ctx.fillStyle = '#061019c9'; ctx.fillRect(x, y + h - fontSize - 18, w, fontSize + 18)
    label(ctx, `${title}${camera ? `  ${camera.name}` : ''}`, x + 12, y + h - 12, fontSize, '#d2e5e9')
    ctx.restore()
  }
  function renderNvr(state: NvrState, config: NvrConfig, cameras: readonly SimulatedCamera[], size = baseVideoSize) {
    resize(program, size)
    const ctx = program.getContext('2d')!
    ctx.save(); ctx.scale(program.width / 1280, program.height / 720)
    ctx.fillStyle = '#0d1720'; ctx.fillRect(0, 0, 1280, 720)
    label(ctx, config.name.toUpperCase().slice(0, 28), 22, 32, 26, '#d2e5e9')
    ctx.textAlign = 'right'
    label(ctx, `LIVE  ·  CH ${String(state.channel).padStart(2, '0')}  ·  ${state.layout === 1 ? 'FULLSCREEN' : `${state.layout}-WAY SPLIT`}`, 1258, 32, 24, '#88d3b5')
    ctx.textAlign = 'left'
    for (const cell of nvrCells(state)) {
      feed(ctx, nvrCamera(config, cameras, cell.channel), cell.x, cell.y, cell.width, cell.height, `CH ${String(cell.channel).padStart(2, '0')}`)
      if (cell.channel === state.channel) { ctx.strokeStyle = '#91d6b7'; ctx.lineWidth = 3; ctx.strokeRect(cell.x, cell.y, cell.width, cell.height) }
    }
    ctx.restore()
  }
  function renderMonitor(canvas: HTMLCanvasElement, output: MonitorOutput, cameras: readonly SimulatedCamera[]) {
    const ctx = canvas.getContext('2d')!
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'
    if (output.source.type === 'nvr') { ctx.drawImage(program, 0, 0, canvas.width, canvas.height); return }
    if (output.source.type === 'radar' || output.source.type === 'streaming') { ctx.drawImage(sources.get(output.source.type)!, 0, 0, canvas.width, canvas.height); return }
    const source = output.source
    const camera = source.type === 'camera' ? cameras.find(item => item.id === source.cameraId) : undefined
    feed(ctx, camera, 0, 0, canvas.width, canvas.height, output.source.type === 'camera' ? 'DIRECT CAMERA' : output.reason.toUpperCase())
  }
  return { capture, retainCameras, renderNvr, renderSources, renderMonitor, dispose: () => { frames.clear(); sources.clear() } }
}

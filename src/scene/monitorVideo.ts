import type { SimulatedCamera } from '../simulation/cameras'
import { nvrCamera, nvrChannels, type NvrConfig, type NvrState } from '../simulation/nvr'
import type { MonitorOutput } from '../simulation/videoRouting'
import { drawRadar, drawStreaming } from './displaySources'
import type { SceneEnvironment } from '../simulation/environment'

export function createMonitorVideo() {
  const frames = new Map<string, HTMLCanvasElement>()
  const program = document.createElement('canvas')
  program.width = 1280; program.height = 720
  const sources = new Map(['radar', 'streaming'].map(type => { const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 720; return [type, canvas] as const }))
  const started = performance.now()
  function renderSources(environment: SceneEnvironment = 'yacht') {
    const now = performance.now()
    drawRadar(sources.get('radar')!.getContext('2d')!, now / 1000, environment)
    drawStreaming(sources.get('streaming')!.getContext('2d')!, (now - started) / 1000)
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
    const fontSize = Math.max(20, Math.min(30, w / 16))
    ctx.fillStyle = '#061019c9'; ctx.fillRect(x, y + h - fontSize - 18, w, fontSize + 18)
    label(ctx, `${title}${camera ? `  ${camera.name}` : ''}`, x + 12, y + h - 12, fontSize, '#d2e5e9')
    ctx.restore()
  }
  function renderNvr(state: NvrState, config: NvrConfig, cameras: readonly SimulatedCamera[]) {
    const ctx = program.getContext('2d')!
    ctx.fillStyle = '#0d1720'; ctx.fillRect(0, 0, 1280, 720)
    label(ctx, config.name.toUpperCase().slice(0, 28), 22, 32, 26, '#d2e5e9')
    ctx.textAlign = 'right'
    label(ctx, `LIVE  ·  CH ${String(state.channel).padStart(2, '0')}  ·  ${state.layout === 1 ? 'FULLSCREEN' : `${state.layout}-WAY SPLIT`}`, 1258, 32, 24, '#88d3b5')
    ctx.textAlign = 'left'
    const channels = nvrChannels(state)
    const cols = state.layout === 1 ? 1 : state.layout === 4 ? 2 : 4
    const rows = state.layout / cols
    const w = 1280 / cols; const h = 678 / rows
    channels.forEach((channel, i) => {
      const x = (i % cols) * w; const y = 42 + Math.floor(i / cols) * h
      feed(ctx, nvrCamera(config, cameras, channel), x + 2, y + 2, w - 4, h - 4, `CH ${String(channel).padStart(2, '0')}`)
      if (channel === state.channel) { ctx.strokeStyle = '#91d6b7'; ctx.lineWidth = 3; ctx.strokeRect(x + 2, y + 2, w - 4, h - 4) }
    })
  }
  function renderMonitor(canvas: HTMLCanvasElement, output: MonitorOutput, cameras: readonly SimulatedCamera[]) {
    const ctx = canvas.getContext('2d')!
    if (output.source.type === 'nvr') { ctx.drawImage(program, 0, 0, canvas.width, canvas.height); return }
    if (output.source.type === 'radar' || output.source.type === 'streaming') { ctx.drawImage(sources.get(output.source.type)!, 0, 0, canvas.width, canvas.height); return }
    const source = output.source
    const camera = source.type === 'camera' ? cameras.find(item => item.id === source.cameraId) : undefined
    feed(ctx, camera, 0, 0, canvas.width, canvas.height, output.source.type === 'camera' ? 'DIRECT CAMERA' : output.reason.toUpperCase())
  }
  return { capture, renderNvr, renderSources, renderMonitor, dispose: () => { frames.clear(); sources.clear() } }
}

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import CameraScene from './CameraScene.vue'
import type { SceneEnvironment } from '../simulation/environment'
import SerialConnection from './SerialConnection.vue'
import type { SerialPortInfo } from '../simulation/serialPorts'
import { createMonitorVideo } from '../scene/monitorVideo'
import { hexBytes, parseHex } from '../protocol/pelcoD'
import { makeNvrChannel, makeNvrKey, splitKey } from '../protocol/nvr'
import type { SimulatedCamera } from '../simulation/cameras'
import { nvrCamera, nvrChannels, type NvrConfig, type NvrState } from '../simulation/nvr'
import { baudRates, type Switcher, type VideoSource } from '../simulation/switcher'
import { inputSource, monitorOutputs } from '../simulation/videoRouting'
import type { CaptureEntry } from '../simulation/history'

const props = defineProps<{ environment: SceneEnvironment; night: boolean; waveStrength: number; cameras: SimulatedCamera[]; switchers: Switcher[]; nvr: NvrState; config: NvrConfig; entries: CaptureEntry[]; connected: boolean; path: string; busy: boolean; bridgeConnected: boolean; error: string; pending: number; storageError: string; defaultsRestored: boolean; serialPath: string; serialBaud: number; ports: SerialPortInfo[]; refreshing: boolean; portsError: string }>()
const emit = defineEmits<{ bytes: [bytes: number[], complete: boolean]; config: [config: NvrConfig]; switchers: [devices: Switcher[]]; route: [device: Switcher, output: number, input: number]; serial: [path: string, baudRate: number]; inspect: [entry: CaptureEntry]; configureSwitchers: []; reset: []; undoReset: []; dismissReset: []; 'update:serialPath': [value: string]; 'update:serialBaud': [value: number]; refreshPorts: [] }>()
const page = ref(0)
const outputs = computed(() => monitorOutputs(props.switchers, props.cameras))
const pages = computed(() => Math.max(1, Math.ceil(outputs.value.length / 4)))
const visible = computed(() => outputs.value.slice(page.value * 4, page.value * 4 + 4))
const nvrOutputs = computed(() => outputs.value.filter(item => item.source.type === 'nvr').length)
const layoutLabel = computed(() => props.nvr.layout === 1 ? 'Fullscreen' : `${props.nvr.layout}-way split`)
const selectedChannel = ref(1)
const settingsOpen = ref(false)
const selectedSwitcher = ref('')
const device = computed(() => props.switchers.find(item => item.id === selectedSwitcher.value) ?? props.switchers[0])
const raw = ref('AA 2B DF 01 AA 2B DF 00'); const rawError = ref('')
const recentNvr = computed(() => props.entries.filter(item => item.protocol === 'nvr').slice(0, 8))
const canvases = new Map<string, HTMLCanvasElement>()
let video: ReturnType<typeof createMonitorVideo> | undefined
let paintFrame = 0
let sourceTimer: ReturnType<typeof setInterval> | undefined
function paint() {
  paintFrame = 0
  if (!video) return
  video.renderNvr(props.nvr, props.config, props.cameras)
  video.renderSources(props.environment)
  visible.value.forEach(output => { const canvas = canvases.get(output.key); if (canvas) video!.renderMonitor(canvas, output, props.cameras) })
}
function queuePaint() { if (!paintFrame) paintFrame = requestAnimationFrame(paint) }
function capture(id: string, frame: HTMLCanvasElement) { video?.capture(id, frame); queuePaint() }
function canvasRef(key: string, element: unknown) {
  if (element instanceof HTMLCanvasElement) { canvases.set(key, element); queuePaint() }
  else canvases.delete(key)
}
function sourceLabel(source: VideoSource) { return source.type === 'nvr' ? props.config.name + ' ' + layoutLabel.value : source.type === 'radar' ? 'Radar / chart plotter' : source.type === 'streaming' ? 'Movie streaming' : source.type === 'camera' ? props.cameras.find(item => item.id === source.cameraId)?.name ?? 'Unknown camera' : 'No signal' }
function sourceValue(input: number) {
  if (!device.value) return 'none'
  const source = inputSource(device.value, input, props.cameras)
  return source.type === 'camera' ? source.cameraId : source.type
}
function changeSource(input: number, value: string) {
  if (!device.value) return
  const source: VideoSource = value === 'nvr' || value === 'radar' || value === 'streaming' ? { type: value } : value === 'none' ? { type: 'none' } : { type: 'camera', cameraId: value }
  emit('switchers', props.switchers.map(item => item.id === device.value!.id ? { ...item, inputSources: { ...item.inputSources, [input]: source } } : item))
}
function changeChannel(channel: number, cameraId: string) { emit('config', { ...props.config, channels: { ...props.config.channels, [channel]: cameraId } }) }
function submitRaw() {
  try { rawError.value = ''; emit('bytes', parseHex(raw.value), true) }
  catch (error) { rawError.value = error instanceof Error ? error.message : 'Invalid bytes.' }
}
function route(output: number, input: string) { if (device.value) emit('route', device.value, output, Number(input)) }
const wall = ref<HTMLElement>()
const fullscreen = ref(false)
let previousOverflow = ''
function setFullscreen(active: boolean) {
  if (fullscreen.value === active) return
  if (active) { previousOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden' }
  else document.body.style.overflow = previousOverflow
  fullscreen.value = active
}
async function toggleFullscreen() {
  if (fullscreen.value) {
    if (document.fullscreenElement === wall.value) await document.exitFullscreen().catch(() => {})
    setFullscreen(false)
  } else {
    setFullscreen(true)
    await wall.value?.requestFullscreen?.().catch(() => {})
  }
}
function fullscreenChanged() { if (document.fullscreenElement !== wall.value) setFullscreen(false) }
function keydown(event: KeyboardEvent) { if (event.key === 'Escape' && fullscreen.value) { event.preventDefault(); void toggleFullscreen() } }
watch(() => props.nvr.channel, value => { selectedChannel.value = Math.max(1, value) }, { immediate: true })
watch(pages, value => { page.value = Math.min(page.value, value - 1) })
watch(() => props.switchers.map(item => item.id), ids => { if (!ids.includes(selectedSwitcher.value)) selectedSwitcher.value = ids[0] ?? '' }, { immediate: true })
watch([visible, () => props.nvr.layout, () => props.nvr.channel, () => props.config, () => props.cameras], () => { void nextTick(queuePaint) }, { deep: true })
onMounted(() => { video = createMonitorVideo(); queuePaint(); sourceTimer = setInterval(queuePaint, 100); document.addEventListener('fullscreenchange', fullscreenChanged); document.addEventListener('keydown', keydown) })
onUnmounted(() => { clearInterval(sourceTimer); cancelAnimationFrame(paintFrame); video?.dispose(); if (fullscreen.value) { setFullscreen(false); if (document.fullscreenElement === wall.value) void document.exitFullscreen().catch(() => {}) }; document.removeEventListener('fullscreenchange', fullscreenChanged); document.removeEventListener('keydown', keydown) })
</script>

<template>
  <section class="monitor-simulation" role="tabpanel" aria-labelledby="monitors-tab">
    <div class="monitor-heading"><div><div class="eyebrow">LIVE VIDEO ROUTING</div><h1>Monitor <span>simulation</span></h1><p>Every display follows its switcher’s active input.</p></div><div class="monitor-heading-actions"><button class="button secondary" title="Restore four cameras, NVR channels and the four-source switcher setup" @click="emit('reset')">↻ Reset to default</button><button class="button secondary" @click="settingsOpen = !settingsOpen" :aria-expanded="settingsOpen">{{ settingsOpen ? 'Close wiring' : 'Configure wiring' }}</button><button class="button secondary" @click="toggleFullscreen">⛶ Monitor wall</button></div></div>
    <div v-if="defaultsRestored" class="default-reset-note" role="status"><span>Default setup restored: four cameras, NVR channels and monitor wiring.</span><button class="text-button" @click="emit('undoReset')">Undo reset</button><button class="text-button" aria-label="Dismiss reset notice" @click="emit('dismissReset')">×</button></div>
    <div class="nvr-controls panel"><div class="nvr-identity"><span class="nvr-icon">▦</span><div><strong>{{ config.name }}</strong><small>{{ nvrOutputs }} routed {{ nvrOutputs === 1 ? 'monitor' : 'monitors' }} · Separate NVR serial line</small></div></div><div class="nvr-layout" role="status">CH {{ String(nvr.channel).padStart(2, '0') }} <span>·</span> {{ layoutLabel }}</div><div class="nvr-actions"><label>Camera channel<select v-model.number="selectedChannel" aria-label="NVR camera channel"><option v-for="channel in 32" :key="channel" :value="channel">{{ channel }}{{ nvrCamera(config, cameras, channel) ? ` · ${nvrCamera(config, cameras, channel)!.name}` : ' · No signal' }}</option></select></label><button class="button secondary" @click="emit('bytes', makeNvrChannel(selectedChannel), true)">Select camera</button><button class="button primary" @click="emit('bytes', makeNvrKey(...splitKey), true)">Cycle split <span>↻</span></button></div></div>
    <div v-if="!nvrOutputs && outputs.length" class="monitor-notice">No monitors currently receive the NVR. In Configure wiring, assign an input to NVR output and route a monitor to it.</div>
    <div ref="wall" class="monitor-wall" :class="{ 'wall-fullscreen': fullscreen }">
      <div v-if="fullscreen" class="wall-toolbar"><strong>{{ config.name }} <span>· {{ layoutLabel }}</span></strong><button class="button secondary" @click="toggleFullscreen">Exit fullscreen ×</button></div>
      <div class="monitor-grid" :class="{ single: visible.length === 1 }" :style="{ '--monitor-rows': Math.ceil(visible.length / 2) }">
        <article v-for="output in visible" :key="output.key" class="monitor-unit" :data-source="output.source.type">
          <div class="monitor-bezel"><canvas :ref="element => canvasRef(output.key, element)" width="1280" height="720" :aria-label="`${output.name}: ${output.reason || sourceLabel(output.source)}`" role="img" :data-nvr-layout="output.source.type === 'nvr' ? nvr.layout : undefined"></canvas><div class="bezel-label"><span>IRIS</span><i :class="{ idle: output.source.type === 'none' || Boolean(output.reason) }"></i></div></div>
          <div class="monitor-caption"><strong>{{ output.name }}</strong><span>{{ output.input ? `${output.inputName} → Output ${output.output}` : 'Unrouted' }}</span><small>{{ output.switcherName }} · {{ output.address }}</small></div>
        </article>
      </div>
      <div v-if="!outputs.length" class="monitor-empty"><span>▤</span><h2>Add a switcher to create your monitor wall</h2><p>Each configured switcher output becomes a monitor.</p><button class="button primary" @click="emit('configureSwitchers')">Configure switchers</button></div>
      <div v-if="pages > 1" class="wall-pagination"><button class="button secondary" :disabled="page === 0" @click="page--">← Previous</button><span>Monitors {{ page * 4 + 1 }}–{{ Math.min(page * 4 + 4, outputs.length) }} of {{ outputs.length }}</span><button class="button secondary" :disabled="page + 1 >= pages" @click="page++">Next →</button></div>
    </div>

    <div v-if="settingsOpen" class="video-wiring panel">
      <div class="panel-heading"><h2>Video wiring</h2><button class="text-button" @click="emit('configureSwitchers')">Edit switcher names & ports ↗</button></div>
      <div class="wiring-columns"><section><label>Switcher<select v-model="selectedSwitcher" aria-label="Video wiring switcher"><option value="" disabled>Choose a switcher</option><option v-for="item in switchers" :key="item.id" :value="item.id">{{ item.name }}</option></select></label><template v-if="device"><h3>Input sources</h3><p>Choose the video connected to each physical input.</p><label v-for="(name, index) in device.inputs" :key="index" class="wiring-row"><span>{{ index + 1 }} · {{ name }}</span><select :value="sourceValue(index + 1)" :aria-label="`Source for input ${index + 1}`" @change="changeSource(index + 1, ($event.target as HTMLSelectElement).value)"><option value="none">No signal</option><option value="nvr">NVR output</option><option value="radar">Radar / chart plotter</option><option value="streaming">Movie streaming</option><option v-for="camera in cameras" :key="camera.id" :value="camera.id">{{ camera.name }}</option></select></label><h3>Monitor routes</h3><p>Changing a route sends a Pelco-D switch command on the shared camera bus.</p><label v-for="(name, index) in device.outputs" :key="index" class="wiring-row"><span>{{ name }}</span><select :value="device.routes[index + 1] ?? ''" :disabled="!device.enabled" :aria-label="`Route for ${name}`" @change="route(index + 1, ($event.target as HTMLSelectElement).value)"><option value="" disabled>Unrouted</option><option v-for="(input, i) in device.inputs" :key="i" :value="i + 1">{{ i + 1 }} · {{ input }}</option></select></label></template></section>
        <section><h3>NVR channels</h3><p>Unassigned channels show No signal in the split view.</p><label>NVR name<input :value="config.name" maxlength="80" @change="emit('config', { ...config, name: ($event.target as HTMLInputElement).value.trim() || 'IRIS NVR' })" /></label><label>NVR baud rate<select :value="config.baudRate" @change="emit('config', { ...config, baudRate: Number(($event.target as HTMLSelectElement).value) })"><option v-for="rate in baudRates" :key="rate" :value="rate">{{ rate }}</option></select></label><div class="nvr-channel-mapping"><label v-for="channel in 32" :key="channel" class="wiring-row"><span>Channel {{ channel }}</span><select :value="nvrCamera(config, cameras, channel)?.id ?? ''" :aria-label="`Camera for NVR channel ${channel}`" @change="changeChannel(channel, ($event.target as HTMLSelectElement).value)"><option value="">No signal</option><option v-for="camera in cameras" :key="camera.id" :value="camera.id">{{ camera.name }}</option></select></label></div></section></div>
      <p v-if="storageError" class="error-message" role="alert">{{ storageError }}</p>
    </div>

    <details class="panel nvr-serial"><summary>NVR serial input <span>{{ connected ? path : 'API / manual bytes ready' }}{{ pending ? ` · ${pending} pending bytes` : '' }}</span></summary><div class="nvr-serial-grid"><section><h3>Dedicated serial port</h3><SerialConnection line="nvr" :ports="ports" :path="serialPath" :baud-rate="serialBaud" :connected="connected" :connected-path="path" :busy="busy" :bridge-connected="bridgeConnected" :error="error" :refreshing="refreshing" :ports-error="portsError" @update:path="emit('update:serialPath', $event)" @update:baud-rate="emit('update:serialBaud', $event)" @toggle="(path, baud) => emit('serial', path, baud)" @refresh="emit('refreshPorts')" /><p>NVR uses its own AA key protocol and 8N1 serial line. Cameras and switchers continue sharing the Pelco-D bus.</p></section><section><h3>Send NVR bytes</h3><label>NVR command bytes<textarea v-model="raw" rows="3" spellcheck="false"></textarea></label><button class="button primary" @click="submitRaw">Send NVR bytes</button><p v-if="rawError" class="error-message" role="alert">{{ rawError }}</p><p>Four bytes per key event: AA · key A · key B · 01 press / 00 release. Only the press changes the display.</p><p>POST binary bytes or JSON <code>{"hex":"AA 2B DF 01 AA 2B DF 00"}</code> to <code>http://127.0.0.1:4311/api/nvr/bytes</code>.</p></section></div><div v-if="recentNvr.length" class="nvr-capture"><button v-for="entry in recentNvr" :key="entry.id" @click="emit('inspect', entry)"><time>{{ entry.time }}</time><code>{{ hexBytes(entry.bytes) }}</code><span>{{ entry.description }}</span><strong :class="{ 'error-text': entry.issues.some(issue => issue.severity === 'error') }">{{ entry.result }}</strong></button></div></details>
    <div class="video-engines" aria-hidden="true"><CameraScene v-for="camera in cameras" :key="`${environment}-${camera.id}`" :environment="environment" :night="night" :wave-strength="waveStrength" :cameras="cameras" :camera-id="camera.id" :camera="camera.state" :show-frustum="false" compact video-only @video-frame="capture(camera.id, $event)" /></div>
    <span class="sr-only" role="status">{{ config.name }} {{ layoutLabel }}. Channels {{ nvrChannels(nvr).join(', ') }}.</span>
  </section>
</template>

<style scoped>
.monitor-heading{display:flex;justify-content:space-between;align-items:center;gap:20px;margin:0 0 22px}.monitor-heading h1{margin:8px 0}.monitor-heading p{font-size:12px;color:#8099a9;margin:0}.monitor-heading-actions{display:flex;gap:10px;flex-wrap:wrap;justify-content:flex-end}.default-reset-note{display:flex;align-items:center;gap:16px;padding:13px 16px;margin-bottom:20px;background:#1b302a;border:1px solid #3c6656;border-radius:7px;font-size:11px;color:#b3d7c7}.default-reset-note>span{flex:1}.default-reset-note button{white-space:nowrap;color:var(--mint)}.nvr-controls{display:flex;align-items:center;gap:24px;padding:16px 20px;margin-bottom:22px}.nvr-identity{display:flex;align-items:center;gap:12px}.nvr-icon{color:var(--mint);font-size:28px}.nvr-identity strong{font-size:13px}.nvr-identity small{display:block;margin-top:5px;font-size:9px;color:#7f98a8}.nvr-layout{font-family:var(--mono);font-size:11px;color:#9bcdbb;white-space:nowrap}.nvr-layout span{color:#536c7b;margin:0 8px}.nvr-actions{display:flex;align-items:flex-end;gap:10px;margin-left:auto}.nvr-actions label{font-size:9px;color:#8da7b5}.nvr-actions select{display:block;margin-top:5px;max-width:190px;font-size:11px;height:34px}.nvr-actions button{height:34px;font-size:11px}.monitor-wall{padding:24px;background:radial-gradient(ellipse at top,#1b2732,#0e151d);border:1px solid #293944;border-radius:9px}.monitor-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:26px 28px;max-width:1440px;margin:auto}.monitor-grid.single{max-width:1100px;grid-template-columns:1fr}.monitor-unit{min-width:0}.monitor-bezel{padding:9px 9px 0;background:linear-gradient(135deg,#303c45,#11191f 45%);border:1px solid #40505d;border-bottom-color:#202b34;border-radius:8px;box-shadow:0 12px 26px #0005}.monitor-bezel canvas{display:block;width:100%;aspect-ratio:16/9;height:auto;background:#080e14;border:1px solid #050a0d}.bezel-label{height:22px;display:flex;align-items:center;justify-content:center;position:relative}.bezel-label span{font-size:8px;font-weight:600;letter-spacing:3px;color:#677d8c}.bezel-label i{position:absolute;right:7px;width:4px;height:4px;border-radius:50%;background:#9cc8b4;box-shadow:0 0 6px #73caa5}.bezel-label i.idle{background:#826b42;box-shadow:none}.monitor-caption{padding:12px 4px 0;display:grid;grid-template-columns:1fr auto;gap:5px 12px}.monitor-caption strong{font-size:12px;color:#c6d9e3}.monitor-caption span{font-size:10px;color:#8da6b5;text-align:right}.monitor-caption small{font-size:9px;color:#546f80}.monitor-notice{font-size:11px;color:#bea885;padding:0 0 18px;line-height:1.7}.monitor-empty{text-align:center;padding:80px 20px;color:#8da5b6}.monitor-empty>span{font-size:40px}.monitor-empty h2{font-size:18px;color:#c7dbe5}.monitor-empty p{font-size:12px;margin-bottom:24px}.wall-pagination{display:flex;align-items:center;justify-content:center;gap:20px;margin-top:24px}.wall-pagination span{font-size:10px;color:#8da5b6}.video-wiring{margin-top:22px}.wiring-columns{display:grid;grid-template-columns:1fr 1fr;gap:30px;padding:24px}.wiring-columns section{min-width:0}.video-wiring label,.nvr-serial label{display:flex;flex-direction:column;gap:7px;font-size:11px;color:#9ab1be;margin-bottom:14px}.video-wiring input,.video-wiring select,.nvr-serial input,.nvr-serial select{font-size:11px;padding:9px;min-width:0}.video-wiring h3,.nvr-serial h3{font-size:13px;color:#c7d9e3;margin:16px 0 10px}.video-wiring p,.nvr-serial p{color:#7e98a8;font-size:10px;line-height:1.8}.video-wiring .wiring-row{flex-direction:row;align-items:center;justify-content:space-between;gap:12px}.wiring-row span{min-width:0;overflow-wrap:anywhere}.wiring-row select{width:55%;max-width:250px}.nvr-channel-mapping{max-height:310px;overflow:auto;padding-right:8px}.nvr-serial{margin-top:22px}.nvr-serial>summary{padding:18px 20px;font-size:12px;cursor:pointer}.nvr-serial>summary span{font-size:10px;color:#718f9f;margin-left:15px}.nvr-serial-grid{display:grid;grid-template-columns:1fr 1fr;gap:30px;padding:0 24px 16px}.nvr-serial textarea{font-family:var(--mono);padding:12px;line-height:1.7;font-size:13px}.nvr-serial code{overflow-wrap:anywhere;color:#9cc3cf;font-size:10px}.nvr-capture{padding:0 24px 20px}.nvr-capture button{width:100%;display:grid;grid-template-columns:90px 160px 1fr 70px;gap:12px;text-align:left;align-items:center;border:0;border-top:1px solid #2a3944;background:none;padding:11px 0;font-size:10px;color:#99b0c0}.nvr-capture time{font-family:var(--mono);color:#647f91}.nvr-capture strong{font-size:9px;color:var(--mint);text-align:right}.video-engines{position:fixed;left:-10000px;top:0;width:640px;pointer-events:none}.video-engines :deep(.scene-host){width:640px;height:360px;min-height:360px}.wall-fullscreen{display:flex;flex-direction:column;position:fixed;inset:0;z-index:1000;border:0;border-radius:0;overflow:hidden;padding:24px;height:100dvh}.wall-fullscreen .monitor-grid{max-width:1600px;width:100%;flex:1;min-height:0;grid-template-rows:repeat(var(--monitor-rows),minmax(0,1fr))}.wall-fullscreen .monitor-unit{display:flex;flex-direction:column;min-height:0}.wall-fullscreen .monitor-bezel{display:flex;flex-direction:column;flex:1;min-height:0}.wall-fullscreen canvas{flex:1;min-height:0;height:0;aspect-ratio:auto;object-fit:contain}.wall-fullscreen .bezel-label,.wall-fullscreen .monitor-caption,.wall-toolbar,.wall-pagination{flex-shrink:0}.wall-toolbar{width:100%;max-width:1600px;margin:0 auto 20px;display:flex;align-items:center;justify-content:space-between;font-size:12px}.wall-toolbar strong span{color:#6f8b9b;font-weight:400}.sr-only{position:absolute;width:1px;height:1px;padding:0;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
@media(max-width:1100px){.nvr-controls{flex-wrap:wrap;gap:16px}.nvr-actions{flex:1;justify-content:flex-end}.nvr-layout{margin-left:auto}.monitor-heading-actions{flex-wrap:wrap;justify-content:flex-end}}
@media(max-width:700px){.monitor-heading{align-items:flex-start}.monitor-heading h1{font-size:24px}.monitor-heading-actions .button{font-size:10px;padding:8px}.nvr-actions{margin-left:0;justify-content:flex-start;flex-wrap:wrap}.monitor-wall{padding:14px}.monitor-grid{grid-template-columns:1fr;gap:22px}.wall-fullscreen .monitor-grid:not(.single){grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.wall-fullscreen .monitor-caption{font-size:10px}.wall-fullscreen .monitor-caption span,.wall-fullscreen .monitor-caption small{display:none}.monitor-caption{grid-template-columns:1fr}.monitor-caption span{text-align:left}.wiring-columns,.nvr-serial-grid{grid-template-columns:1fr;gap:10px;padding:18px}.nvr-capture{padding:0 18px 18px}.nvr-capture button{grid-template-columns:1fr auto}.nvr-capture code{grid-row:2}.nvr-capture span{grid-column:1/-1}.nvr-serial>summary span{display:block;margin:8px 0 0}.wall-pagination{gap:10px}.wall-pagination .button{font-size:10px}.wall-pagination span{font-size:9px}}
</style>

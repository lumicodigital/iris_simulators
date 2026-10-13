<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import CameraScene from './components/CameraScene.vue'
import { decode, fields, hex, hexBytes, makePacket, parseHex, PelcoDStream, type Packet, type StreamEvent, type Issue } from './protocol/pelcoD'
import { applyPacket, cameraRates, createCamera, defaultProfile, stepCamera, stopCamera, zoomSpeedFactor } from './simulation/camera'
import { findPalette, paletteGradient, thermalPalettes } from './simulation/thermalPalettes'

interface Entry { id: number; time: string; source: string; bytes: number[]; issues: Issue[]; packet?: Packet; description: string; result: string }
interface Port { path: string; manufacturer?: string }
const camera = reactive(createCamera())
const profile = reactive({ ...defaultProfile })
const turboByte = ref(0xff)
const address = ref(1)
const tab = ref('hex')
const input = ref('FF 01 00 02 20 00 23')
const inputError = ref('')
const entries = ref<Entry[]>([])
const selected = ref<Entry>()
const filter = ref('all')
const totalBytes = ref(0); const totalFrames = ref(0); const totalRejected = ref(0)
const showFrustum = ref(true)
const scene = ref<InstanceType<typeof CameraScene>>()
const ports = ref<Port[]>([])
const serialPath = ref(''); const baudRate = ref(2400)
const serialConnected = ref(false); const connectedPath = ref('')
const bridgeConnected = ref(false); const connectionError = ref(''); const busy = ref(false)
const manualStream = new PelcoDStream()
const serialStream = new PelcoDStream()
const apiStream = new PelcoDStream()
const pending = ref<number[]>([])
let socket: WebSocket | undefined; let reconnect: ReturnType<typeof setTimeout> | undefined
let interval: ReturnType<typeof setInterval> | undefined; let frame = 0; let sequence = 0; let disposed = false
let held: string | null = null; let repeat: ReturnType<typeof setInterval> | undefined
const panSpeed = ref(32); const tiltSpeed = ref(24); const preset = ref(1)
const visibleEntries = computed(() => entries.value.filter(entry => filter.value === 'all' || entry.issues.some(issue => issue.severity !== 'info')))
const displayPan = computed(() => ((camera.pan - camera.zeroPan) % 360 + 360) % 360)
const rates = computed(() => cameraRates(camera, profile))
const moving = computed(() => camera.target ? 'Moving to preset' : camera.scanning ? 'Auto scan' : [camera.motion.pan ? `Pan ${camera.motion.pan > 0 ? 'right' : 'left'}` : '', camera.motion.tilt ? `Tilt ${camera.motion.tilt > 0 ? 'up' : 'down'}` : '', camera.motion.zoom ? `Zoom ${camera.motion.zoom > 0 ? 'tele' : 'wide'}` : '', camera.motion.focus ? 'Focus' : '', camera.motion.iris ? 'Iris' : ''].filter(Boolean).join(' · ') || 'Stationary')
const fieldNotes = ['Always FF', 'Camera address', 'Power / lens flags', 'Motion / opcode', 'Pan speed / data', 'Tilt speed / data', 'Sum bytes 2–6']
function addEntry(event: StreamEvent, source: string) {
  const packet = event.issue ? undefined : decode(event.bytes, address.value, turboByte.value)
  const result = packet ? applyPacket(camera, packet) : 'Rejected'
  const entry: Entry = { id: ++sequence, time: new Date().toLocaleTimeString('en-GB', { hour12: false }) + '.' + String(Date.now() % 1000).padStart(3, '0'), source, bytes: event.bytes, issues: packet?.issues ?? [event.issue!], packet, description: packet?.description ?? 'Framing error', result }
  entries.value.unshift(entry); entries.value = entries.value.slice(0, 200)
  selected.value = entry
  if (packet) totalFrames.value++
  if (result === 'Rejected') totalRejected.value++
}
function receive(bytes: number[], source: string, stream: PelcoDStream, complete = false) {
  totalBytes.value += bytes.length
  stream.push(bytes).forEach(event => addEntry(event, source))
  if (complete) stream.flush().forEach(event => addEntry(event, source))
  pending.value = [...serialStream.pending, ...apiStream.pending]
}
function submit() {
  try { inputError.value = ''; receive(parseHex(input.value), 'manual', manualStream, true) }
  catch (error) { inputError.value = error instanceof Error ? error.message : 'Invalid hex input.' }
}
function repairChecksum() {
  try {
    const bytes = parseHex(input.value)
    if (bytes.length !== 7) throw new Error('Checksum repair needs exactly one 7-byte packet.')
    bytes[6] = bytes.slice(1, 6).reduce((sum, byte) => sum + byte, 0) & 0xff
    input.value = hexBytes(bytes); inputError.value = ''
  } catch (error) { inputError.value = error instanceof Error ? error.message : 'Cannot repair checksum.' }
}
function sample(name: string) {
  const samples: Record<string, number[]> = { right: makePacket(address.value, 0, 2, 32), diagonal: makePacket(address.value, 0, 0x0a, 32, 24), zoom: makePacket(address.value, 0, 0x20), stop: makePacket(address.value), checksum: [...makePacket(address.value, 0, 2, 32).slice(0, 6), 0], conflict: makePacket(address.value, 0, 6, 32) }
  input.value = hexBytes(samples[name]); inputError.value = ''
}
function localCommand(cmd1 = 0, cmd2 = 0, data1 = 0, data2 = 0) {
  const bytes = makePacket(address.value, cmd1, cmd2, data1, data2)
  receive(bytes, 'controls', manualStream, true)
}
function selectThermalPalette() { localCommand(0, 7, 0, findPalette(camera.thermalPalette).preset) }
function toggleLamp() {
  localCommand(0, 7, 0, 90)
  localCommand(0, 7, 0, camera.lampOn ? 3 : 4)
}
function resetFeatures() {
  camera.thermalEnabled = false; camera.thermalPalette = 'white-hot'; camera.thermalInverted = false
  camera.lampOn = false; camera.lampArmedUntil = 0
}
function beginHold(direction: string, event: PointerEvent) {
  if (event.button !== 0 || held) return
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  held = direction
  const send = () => {
    const bits: Record<string, number> = { left: 4, right: 2, up: 8, down: 16, tele: 32, wide: 64 }
    localCommand(0, bits[direction], ['left', 'right'].includes(direction) ? (panSpeed.value === 64 ? turboByte.value : panSpeed.value) : 0, ['up', 'down'].includes(direction) ? tiltSpeed.value : 0)
  }
  send(); repeat = setInterval(send, 150)
}
function endHold() { if (!held) return; clearInterval(repeat); held = null; localCommand() }
function emergencyStop() { endHold(); localCommand(); stopCamera(camera) }
function resetCamera() {
  endHold(); stopCamera(camera)
  camera.pan = 0; camera.tilt = 0; camera.zoom = 1; camera.focus = 0.5; camera.iris = 0.7; camera.power = true; camera.watchdogStopped = false; camera.zeroPan = 0; camera.autofocus = true
  resetFeatures()
  scene.value?.resetView()
}
function changeAddress() {
  address.value = Math.min(255, Math.max(1, Math.round(Number(address.value) || 1)))
  endHold(); stopCamera(camera); camera.presets.clear()
  resetFeatures()
  serialStream.flush('Address changed while receiving an incomplete packet.').forEach(event => addEntry(event, 'serial'))
  apiStream.flush('Address changed while receiving an incomplete packet.').forEach(event => addEntry(event, 'api'))
  pending.value = []
}
async function request(path: string, body?: object) {
  const response = await fetch(`/api/${path}`, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined)
  const result = await response.json()
  if (!response.ok) throw new Error(result.error ?? 'Bridge request failed.')
  return result
}
async function refreshPorts() {
  try { ports.value = await request('ports'); connectionError.value = '' }
  catch (error) { connectionError.value = error instanceof Error ? error.message : 'Cannot list serial ports.' }
}
async function toggleSerial() {
  busy.value = true; connectionError.value = ''
  try { await request(serialConnected.value ? 'disconnect' : 'connect', serialConnected.value ? {} : { path: serialPath.value, baudRate: baudRate.value }) }
  catch (error) { connectionError.value = error instanceof Error ? error.message : 'Serial connection failed.' }
  finally { busy.value = false }
}
function connectBridge() {
  socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/serial`)
  socket.onopen = () => { bridgeConnected.value = true; connectionError.value = '' }
  socket.onmessage = event => {
    const message = JSON.parse(event.data)
    if (message.type === 'status') {
      if (serialConnected.value && (!message.connected || message.path !== connectedPath.value)) {
        serialStream.flush('Serial device disconnected during a packet.').forEach(event => addEntry(event, 'serial')); stopCamera(camera)
      }
      serialConnected.value = message.connected; connectedPath.value = message.path
      pending.value = [...serialStream.pending, ...apiStream.pending]
    } else if (message.type === 'bytes') receive(message.bytes, message.source, message.source === 'api' ? apiStream : serialStream)
    else if (message.type === 'error') connectionError.value = message.message
  }
  socket.onclose = () => {
    bridgeConnected.value = false; serialConnected.value = false
    serialStream.flush('Bridge disconnected during a packet.').forEach(event => addEntry(event, 'serial'))
    apiStream.flush('Bridge disconnected during a packet.').forEach(event => addEntry(event, 'api'))
    pending.value = []; stopCamera(camera)
    if (!disposed) { connectionError.value = 'Serial bridge offline. Reconnecting…'; reconnect = setTimeout(connectBridge, 2000) }
  }
}
function exportLog() {
  const blob = new Blob([JSON.stringify(entries.value.slice().reverse(), null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob); const link = document.createElement('a')
  link.href = url; link.download = 'pelco-d-capture.json'; link.click(); URL.revokeObjectURL(url)
}
function clearLog() { entries.value = []; selected.value = undefined; totalBytes.value = 0; totalFrames.value = 0; totalRejected.value = 0 }
function onVisibility() { if (document.hidden) endHold() }
onMounted(() => {
  connectBridge(); refreshPorts()
  let previous = performance.now()
  const animate = (now: number) => {
    const elapsed = (now - previous) / 1000; previous = now
    stepCamera(camera, profile, elapsed)
    frame = requestAnimationFrame(animate)
  }
  frame = requestAnimationFrame(animate)
  interval = setInterval(() => {
    serialStream.expire().forEach(event => addEntry(event, 'serial'))
    apiStream.expire().forEach(event => addEntry(event, 'api'))
    pending.value = [...serialStream.pending, ...apiStream.pending]
  }, 100)
  window.addEventListener('blur', endHold); document.addEventListener('visibilitychange', onVisibility)
})
onUnmounted(() => {
  disposed = true; clearTimeout(reconnect); clearInterval(interval); clearInterval(repeat)
  cancelAnimationFrame(frame); socket?.close(); window.removeEventListener('blur', endHold); document.removeEventListener('visibilitychange', onVisibility)
})
</script>

<template>
  <div class="app-shell">
    <header class="topbar">
      <a class="brand" href="/" aria-label="IRIS Simulators home"><span class="brand-mark"><i></i><i></i><i></i><i></i></span><strong>IRIS<span> / </span>SIMULATORS</strong></a>
      <span class="workspace-label">PROTOCOL WORKBENCH</span>
      <div class="header-status"><i class="status-dot" :class="{ offline: !bridgeConnected }"></i>{{ bridgeConnected ? 'Bridge online' : 'Bridge offline' }}<span class="version">v0.1</span></div>
    </header>

    <main>
      <div class="page-heading"><div><div class="eyebrow">CAMERA SYSTEMS <span>/</span> SERIAL PROTOCOLS</div><h1>Pelco-D <span>simulator</span><span class="protocol-badge">7-BYTE PROTOCOL</span></h1><p>See what your bytes do. Inspect every command. Understand every movement.</p></div><button class="button danger-outline" @click="emergencyStop"><span class="stop-square"></span> Stop motion</button></div>

      <div class="workbench">
        <section class="panel visualization-panel">
          <div class="panel-heading"><h2><span class="small-icon">◈</span> Camera visualization</h2><div class="view-actions"><label><input v-model="showFrustum" type="checkbox" /> Field of view</label><button class="icon-button" @click="scene?.resetView()" aria-label="Reset orbit view" title="Reset orbit view">↻</button></div></div>
          <CameraScene ref="scene" :camera="camera" :show-frustum="showFrustum" />
          <div class="telemetry">
            <div><span>PAN ANGLE</span><strong>{{ displayPan.toFixed(1) }}<small>°</small></strong><em>{{ rates.pan.toFixed(1) }}° / s</em></div>
            <div><span>TILT ANGLE</span><strong>{{ camera.tilt.toFixed(1) }}<small>°</small></strong><em>{{ rates.tilt.toFixed(1) }}° / s</em></div>
            <div><span>OPTICAL ZOOM</span><strong>{{ camera.zoom.toFixed(1) }}<small>×</small></strong><em>{{ (100 * zoomSpeedFactor(camera.zoom)).toFixed(0) }}% pan / tilt speed</em></div>
            <div class="motion-telemetry"><span>CAMERA STATE</span><strong :class="{ mint: moving !== 'Stationary' }">{{ moving }}</strong><em>{{ camera.power ? 'Camera on' : 'Camera off' }} · Lens {{ (camera.focus * 100).toFixed(0) }}% / iris {{ (camera.iris * 100).toFixed(0) }}%</em></div>
          </div>
          <div v-if="camera.watchdogStopped" class="inline-warning" role="status">Motion stopped: no fresh motion command within {{ profile.watchdogMs / 1000 }} seconds.</div>
          <div class="camera-controls">
            <div class="control-label"><strong>Try a movement</strong><span>Hold a control to send commands</span></div>
            <div class="direction-pad"><button v-for="direction in ['left', 'up', 'down', 'right']" :key="direction" class="direction-button" :aria-label="`Hold to ${direction === 'up' || direction === 'down' ? 'tilt' : 'pan'} ${direction}`" @pointerdown="beginHold(direction, $event)" @pointerup="endHold" @pointercancel="endHold" @lostpointercapture="endHold">{{ ({ left: '←', up: '↑', down: '↓', right: '→' } as Record<string, string>)[direction] }}</button></div>
            <div class="zoom-controls"><button class="direction-button" aria-label="Hold to zoom wide" @pointerdown="beginHold('wide', $event)" @pointerup="endHold" @pointercancel="endHold" @lostpointercapture="endHold">−</button><span>ZOOM</span><button class="direction-button" aria-label="Hold to zoom tele" @pointerdown="beginHold('tele', $event)" @pointerup="endHold" @pointercancel="endHold" @lostpointercapture="endHold">+</button></div>
            <button class="text-button reset-button" @click="resetCamera">↻ Reset camera</button>
          </div>
          <div class="camera-effects">
            <div class="view-mode" role="group" aria-label="Camera view mode"><button :class="{ active: !camera.thermalEnabled }" :aria-pressed="!camera.thermalEnabled" @click="localCommand(0, 7, 0, 226)">Daylight</button><button :class="{ active: camera.thermalEnabled }" :aria-pressed="camera.thermalEnabled" @click="localCommand(0, 7, 0, 229)">Thermal</button></div>
            <label class="palette-select" for="thermal-palette">Thermal palette<select id="thermal-palette" v-model="camera.thermalPalette" @change="selectThermalPalette"><option v-for="palette in thermalPalettes" :key="palette.id" :value="palette.id">{{ palette.name }}</option></select></label>
            <span class="palette-swatch" :style="{ background: paletteGradient(camera.thermalPalette) }" aria-hidden="true"></span>
            <button class="button lamp-button" :class="{ 'lamp-active': camera.lampOn }" :aria-pressed="camera.lampOn" :aria-label="camera.lampOn ? 'Turn lamp off' : 'Turn lamp on'" @click="toggleLamp"><span aria-hidden="true">☀</span> Lamp {{ camera.lampOn ? 'on' : 'off' }}</button>
          </div>
          <div class="camera-effects-note">The camera view uses synthetic heat values. Selecting a palette opens thermal view.</div>
        </section>

        <aside class="panel input-panel">
          <div class="panel-heading"><h2><span class="small-icon">⌁</span> Command source</h2><span class="rx-badge">RX</span></div>
          <div class="input-tabs" role="tablist" aria-label="Command source"><button :class="{ active: tab === 'hex' }" role="tab" :aria-selected="tab === 'hex'" @click="tab = 'hex'">Hex input</button><button :class="{ active: tab === 'serial' }" role="tab" :aria-selected="tab === 'serial'" @click="tab = 'serial'">Serial port <i v-if="serialConnected" class="status-dot"></i></button></div>
          <div class="input-content">
            <div class="address-row"><label for="address">Camera address</label><div class="number-field"><input id="address" v-model.number="address" type="number" min="1" max="255" @change="changeAddress" /><span>0x{{ hex(address) }}</span></div></div>
            <template v-if="tab === 'hex'">
              <div class="field-label"><label for="hex-input">COMMAND BYTES</label><span>HEX</span></div>
              <textarea id="hex-input" v-model="input" spellcheck="false" rows="3" aria-describedby="hex-help" @keydown.ctrl.enter.prevent="submit" @keydown.meta.enter.prevent="submit"></textarea>
              <div id="hex-help" class="input-hint">Space-separated or continuous hex. Multiple packets accepted.</div>
              <p v-if="inputError" class="error-message" role="alert">{{ inputError }}</p>
              <button class="button primary send-button" @click="submit">Send to simulator <span>↗</span></button>
              <button class="text-button checksum-button" @click="repairChecksum">↻ Recalculate checksum</button>
              <div class="sample-heading">QUICK EXAMPLES</div>
              <div class="sample-buttons"><button @click="sample('right')">Pan right</button><button @click="sample('diagonal')">Pan + tilt</button><button @click="sample('zoom')">Zoom in</button><button @click="sample('stop')">Stop</button><button class="bad-sample" @click="sample('checksum')">Bad checksum</button><button class="bad-sample" @click="sample('conflict')">Conflicting bits</button></div>
            </template>
            <template v-else>
              <div class="field-label"><label for="serial-path">SERIAL DEVICE</label><button class="text-button" @click="refreshPorts">↻ Refresh</button></div>
              <input id="serial-path" v-model="serialPath" list="serial-ports" placeholder="/dev/cu.usbserial… or /dev/ttys…" :disabled="serialConnected || busy" />
              <datalist id="serial-ports"><option v-for="port in ports" :key="port.path" :value="port.path">{{ port.manufacturer }}</option></datalist>
              <div class="serial-options"><label for="baud-rate">Baud rate<select id="baud-rate" v-model.number="baudRate" :disabled="serialConnected || busy"><option v-for="rate in [2400, 4800, 9600, 19200, 38400, 57600, 115200]" :key="rate" :value="rate">{{ rate }}</option></select></label><div><span>FORMAT</span><strong>8N1</strong><small>8 data · no parity · 1 stop</small></div></div>
              <button class="button primary send-button" :disabled="busy || !bridgeConnected || (!serialConnected && !serialPath)" @click="toggleSerial">{{ busy ? 'Connecting…' : serialConnected ? 'Disconnect serial' : 'Connect serial' }} <span>⌁</span></button>
              <p v-if="serialConnected" class="connected-device"><i class="status-dot"></i> Receiving from {{ connectedPath }}</p>
              <p v-if="connectionError" class="error-message" role="alert">{{ connectionError }}</p>
              <div class="serial-note">Connect a USB serial adapter, or enter a virtual serial port path to receive bytes from your controller. This bridge receives only; it sends no camera replies.</div>
              <details class="api-details"><summary>Send bytes from another app</summary><p>While this UI is open, POST binary bytes to <code>http://127.0.0.1:4311/api/bytes</code> with <code>Content-Type: application/octet-stream</code>, or JSON <code>{"hex":"FF 01 00 02 20 00 23"}</code>.</p></details>
            </template>
          </div>
          <div class="profile-note"><i>ⓘ</i><p>{{ turboByte === 255 ? 'IRIS / legacy' : 'Pelco v5.2.2' }} PTZ profile<span>At 1×: pan {{ profile.maxPanSpeed }}°/s · turbo {{ profile.turboPanSpeed }}°/s · tilt {{ profile.maxTiltSpeed }}°/s<br>Pan and tilt slow proportionally as zoom increases.</span></p></div>
        </aside>
      </div>

      <section class="panel inspector-panel">
        <div class="panel-heading"><h2><span class="small-icon">▤</span> Packet inspector</h2><div v-if="selected" class="packet-verdict" :class="selected.result === 'Rejected' ? 'error' : selected.issues.some(i => i.severity === 'warning') ? 'warning' : 'success'"><i class="status-dot"></i>{{ selected.result }}</div><span v-else class="muted small">Waiting for a command</span></div>
        <div class="inspector-body">
          <div class="byte-grid"><div v-for="(field, index) in fields" :key="field" class="byte-cell" :class="{ 'byte-error': selected?.issues.some(i => i.severity === 'error' && i.bytes.includes(index)), 'byte-warning': selected?.issues.some(i => i.severity === 'warning' && i.bytes.includes(index)) }"><span class="byte-index">{{ String(index + 1).padStart(2, '0') }} <span>{{ field }}</span></span><strong>{{ selected?.bytes[index] === undefined ? '—' : hex(selected.bytes[index]) }}</strong><span class="binary">{{ selected?.bytes[index]?.toString(2).padStart(8, '0') ?? '········' }}</span><span class="byte-note">{{ fieldNotes[index] }}</span></div></div>
          <div class="decoded-line"><span>DECODED</span><strong>{{ selected?.description ?? 'Send a command to inspect its bytes and see the camera respond.' }}</strong><span v-if="selected?.packet" class="expected-checksum">Expected checksum <code>{{ hex(selected.packet.checksum) }}</code></span></div>
          <div v-if="selected?.issues.length" class="issues-list"><div v-for="(issue, index) in selected.issues" :key="index" class="issue" :class="issue.severity"><span>{{ issue.severity === 'error' ? '×' : issue.severity === 'warning' ? '!' : 'i' }}</span><p>{{ issue.message }}</p></div></div>
          <div v-else-if="selected" class="valid-note"><span>✓</span> All bytes valid. {{ selected.bytes.length }}-byte frame verified.</div>
        </div>
      </section>

      <section class="panel capture-panel">
        <div class="panel-heading"><h2><span class="small-icon">≡</span> Command capture <span class="count-badge">{{ totalFrames }}</span></h2><div class="capture-actions"><div class="filter-switch"><button :class="{ active: filter === 'all' }" @click="filter = 'all'">All commands</button><button :class="{ active: filter === 'issues' }" @click="filter = 'issues'">Issues only</button></div><button class="text-button" :disabled="!entries.length" @click="exportLog">↓ Export</button><button class="text-button" @click="clearLog">Clear</button></div></div>
        <div class="capture-table"><div class="capture-row table-head"><span>TIME</span><span>SOURCE</span><span>RAW BYTES</span><span>COMMAND</span><span>RESULT</span></div><button v-for="entry in visibleEntries" :key="entry.id" class="capture-row" :class="{ selected: selected?.id === entry.id }" @click="selected = entry"><span class="capture-time">{{ entry.time }}</span><span class="source-tag">{{ entry.source }}</span><code>{{ hexBytes(entry.bytes.slice(0, 30)) }}{{ entry.bytes.length > 30 ? ' …' : '' }}</code><span class="capture-description">{{ entry.description }}</span><span class="result-tag" :class="entry.result === 'Rejected' ? 'error' : entry.issues.some(i => i.severity === 'warning') ? 'warning' : entry.result === 'Other address' ? 'neutral' : 'success'">{{ entry.result }}</span></button><div v-if="!visibleEntries.length" class="capture-empty"><span>⌁</span><strong>{{ entries.length ? 'No issues in this capture' : 'Your command stream starts here' }}</strong><p>{{ entries.length ? 'Change the filter to see all received commands.' : 'Send hex bytes or connect a serial device. Every received command will appear here.' }}</p></div></div>
        <div class="capture-footer"><span><i class="status-dot" :class="{ offline: !serialConnected }"></i>{{ serialConnected ? 'Listening on serial' : 'Manual input ready' }}<span v-if="pending.length"> · {{ pending.length }} byte(s) awaiting frame completion</span></span><div><span>{{ totalBytes }} bytes</span><span>{{ totalFrames }} frames</span><span :class="{ 'error-text': totalRejected > 0 }">{{ totalRejected }} rejected</span><span>Latest 200 entries</span></div></div>
      </section>

      <details class="panel settings-panel"><summary>Simulation settings <span>Protocol, speeds & presets</span></summary><div class="settings-content"><label>Protocol profile<select v-model.number="turboByte" @change="emergencyStop"><option :value="255">IRIS / legacy — FF turbo</option><option :value="64">Pelco v5.2.2 — 40 turbo</option></select></label><label>Control pan speed <span>{{ hex(panSpeed === 64 ? turboByte : panSpeed) }}</span><input v-model.number="panSpeed" type="range" min="0" max="64" /></label><label>Control tilt speed <span>{{ hex(tiltSpeed) }}</span><input v-model.number="tiltSpeed" type="range" min="0" max="63" /></label><label>Motion watchdog<select v-model.number="profile.watchdogMs"><option :value="15000">15 seconds</option><option :value="2000">2 seconds</option><option :value="0">Disabled — until stop command</option></select></label><div class="preset-settings"><label for="preset">Preset (1–32)</label><input id="preset" v-model.number="preset" type="number" min="1" max="32" @change="preset = Math.min(32, Math.max(1, Math.round(preset || 1)))" /><div><button class="button secondary" @click="localCommand(0, 3, 0, preset)">Save</button><button class="button secondary" @click="localCommand(0, 7, 0, preset)">Call</button><button class="text-button" @click="localCommand(0, 5, 0, preset)">Clear</button></div><small>{{ camera.presets.size }} saved · Held in memory for this camera address</small></div></div><p class="settings-footnote">Pelco-D: FF sync · 8-bit sum checksum · {{ hex(turboByte) }} turbo · speed 00 is slow motion. Supports standard motion, lens flags, auto focus, power, generic auto scan, absolute pan/tilt, display zero, presets 1–32, flip (33), and zero pan (34), plus IRIS thermal palette/mode presets and lamp control (90 → 3/4). Extended commands outside this set are flagged. This is a receive-only visual simulator; it does not implement protocol replies. <a href="https://www.ptzprotocols.com/1%20Pelco%20PTZ%20Protocols/D/DPprotoEPDF.pdf" target="_blank" rel="noopener noreferrer">Protocol reference ↗</a></p></details>
      <footer class="page-footer"><span>IRIS SIMULATORS <i>·</i> PELCO-D WORKBENCH</span><span>Local simulation. Real bytes.</span></footer>
    </main>
  </div>
</template>

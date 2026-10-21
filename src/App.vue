<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, shallowRef, watch } from 'vue'
import SessionRecorder from './components/SessionRecorder.vue'
import { simulationClock, simulationStep } from './simulation/clock'
import { thermalSettings, thermalRanges, setThermalRange } from './simulation/thermal'
import { SessionPlayback, parseSession, sessionStorageKey, maxSessionDuration, maxSessionEvents, type SessionSnapshot, type RecordedSession, type SessionEvent } from './simulation/sessions'
import CameraScene from './components/CameraScene.vue'
import MonitorSwitchers from './components/MonitorSwitchers.vue'
import SharedBusPanel from './components/SharedBusPanel.vue'
import SimulatorOverview from './components/SimulatorOverview.vue'
import MonitorSimulation from './components/MonitorSimulation.vue'
import SerialConnection from './components/SerialConnection.vue'
import SerialSourceMenu from './components/SerialSourceMenu.vue'
import PacketInspector from './components/PacketInspector.vue'
import { hex, hexBytes, makePacket, parseHex } from './protocol/pelcoD'
import { decodeNvr, NvrStream } from './protocol/nvr'
import { applyNvrPacket, createNvr, loadNvrConfig, nvrStorageKey, type NvrConfig, type NvrState } from './simulation/nvr'
import { cameraRates, createCamera, defaultProfile, stepCamera, stopCamera, zoomSpeedFactor } from './simulation/camera'
import { findPalette, paletteGradient, thermalPalettes } from './simulation/thermalPalettes'
import { dispatchPacket, SharedSerialBus, type BusStreamEvent } from './simulation/serialBus'
import { createSwitcher, loadSwitchers, switcherStorageKey, type Switcher } from './simulation/switcher'
import { createDefaultNvrConfig } from './simulation/defaults'

import { cameraStorageKey, completeYachtCameras, createDefaultCameras, loadCameras, maxCameras, normalizeCameraConfig, type CameraConfig, type SimulatedCamera } from './simulation/cameras'
import { environmentStorageKey, loadEnvironment, loadTimeOfDay, loadWaveStrength, normalizeWaveStrength, nightStorageKey, timeOfDayStorageKey, waveStrengthStorageKey, yachtMountFor, type SceneEnvironment, type TimeOfDay } from './simulation/environment'
import { cameraHistory, captureSummary, pelcoAddress, type CaptureEntry as Entry } from './simulation/history'
import type { SerialPortInfo } from './simulation/serialPorts'
const sessionMode = ref<'live' | 'recording' | 'playing' | 'paused'>('live')
const isReplaying = computed(() => sessionMode.value === 'playing' || sessionMode.value === 'paused')
let restoringSession = false
const cameras = ref(loadCameras())
const selectedCameraId = ref(cameras.value[0].id)
const selectedCamera = computed(() => cameras.value.find(item => item.id === selectedCameraId.value) ?? cameras.value[0])
const camera = computed(() => selectedCamera.value.state)
const profile = reactive({ ...defaultProfile })
const turboByte = ref(0xff)
const address = computed({ get: () => selectedCamera.value.address, set: value => { selectedCamera.value.address = value } })
const activeSimulator = ref('monitors')
const sceneEnvironment = ref(loadEnvironment())
const thermalRangeIndex = computed(() => thermalRanges.findIndex(range => range.min === thermalSettings.min && range.max === thermalSettings.max))
const timeOfDay = ref(loadTimeOfDay())
const night = computed(() => timeOfDay.value === 'night')
const waveStrength = ref(loadWaveStrength())
watch(waveStrength, value => { if (isReplaying.value || restoringSession) return; try { localStorage.setItem(waveStrengthStorageKey, String(normalizeWaveStrength(value))) } catch { /* Keep sea state adjustable for this session. */ } }, { flush: 'sync' })
watch(timeOfDay, value => {
  if (isReplaying.value || restoringSession) return
  try { localStorage.setItem(timeOfDayStorageKey, value); localStorage.setItem(nightStorageKey, String(value === 'night')) }
  catch { /* Keep lighting available for this session. */ }
}, { flush: 'sync' })
function onLightingKey(event: KeyboardEvent) {
  if (isReplaying.value) return
  if (event.defaultPrevented || event.repeat || event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return
  const target = event.target
  if (target instanceof Element && (target.closest('input, textarea, select, [role="textbox"], [role="combobox"]') || (target instanceof HTMLElement && target.isContentEditable))) return
  const key = event.key.toLowerCase()
  const modes: Record<string, TimeOfDay> = { d: 'day', g: 'golden-hour', n: 'night' }
  const selected = key === 't' ? (night.value ? 'day' : 'night') : modes[key]
  if (!selected) return
  event.preventDefault(); timeOfDay.value = selected
}
const switchers = ref(loadSwitchers(cameras.value[0].id))
const nvr = reactive(createNvr())
const nvrConfig = ref(loadNvrConfig(cameras.value))
const defaultsRestored = ref(false)
let setupBeforeReset: { cameras: SimulatedCamera[]; switchers: Switcher[]; config: NvrConfig; nvr: Pick<NvrState, 'channel' | 'layout'>; cameraId: string; baud: number } | undefined
const nvrStorageError = ref('')
watch(nvrConfig, config => {
  if (isReplaying.value || restoringSession) return
  try { localStorage.setItem(nvrStorageKey, JSON.stringify(config)); nvrStorageError.value = '' }
  catch { nvrStorageError.value = 'NVR wiring cannot be saved in this browser.' }
}, { deep: true, flush: 'sync' })
const storageError = ref('')
const cameraStorageError = ref('')
const cameraBaudRate = computed({ get: () => selectedCamera.value.baudRate, set: value => { selectedCamera.value.baudRate = value } }); const busBaudRate = ref(9600)
const busSettings = computed(() => ({ cameraAddress: address.value, cameraBaudRate: cameraBaudRate.value, baudRate: busBaudRate.value, turboByte: turboByte.value, cameras: cameras.value }))
watch(switchers, devices => {
  if (isReplaying.value || restoringSession) return
  try { localStorage.setItem(switcherStorageKey, JSON.stringify(devices)); storageError.value = '' }
  catch { storageError.value = 'Browser storage is unavailable. Switchers work for this session but cannot be saved.' }
}, { deep: true, flush: 'sync' })
watch(() => cameras.value.map(({ state, ...config }) => config), configs => {
  if (isReplaying.value || restoringSession) return
  try { localStorage.setItem(cameraStorageKey, JSON.stringify(configs)); cameraStorageError.value = '' }
  catch { cameraStorageError.value = 'Camera configuration cannot be saved in this browser.' }
}, { deep: true, flush: 'sync' })
function selectCamera(id: string, openControls = false) {
  endHold()
  selectedCameraId.value = id
  if (openControls) activeSimulator.value = 'camera'
}
function updateCameras(configs: CameraConfig[]) {
  if (isReplaying.value) return
  const valid = configs.slice(0, maxCameras).map(normalizeCameraConfig).filter((item): item is CameraConfig => Boolean(item))
  if (!valid.length || new Set(valid.map(item => item.id)).size !== valid.length) return
  endHold()
  cameras.value = valid.map(config => {
    const previous = cameras.value.find(item => item.id === config.id)
    return { ...config, state: previous?.address === config.address ? previous.state : createCamera() }
  })
  if (!cameras.value.some(item => item.id === selectedCameraId.value)) selectedCameraId.value = cameras.value[0].id
}
function changeEnvironment(environment: SceneEnvironment) {
  if (isReplaying.value) return
  if (environment === 'yacht') {
    const before = new Set(cameras.value.map(camera => camera.id))
    updateCameras(completeYachtCameras(cameras.value, switchers.value.map(device => device.address)))
    const channels = { ...nvrConfig.value.channels }
    for (const camera of cameras.value.filter(camera => !before.has(camera.id))) {
      const channel = Array.from({ length: 32 }, (_, i) => i + 1).find(value => !Object.hasOwn(channels, value))
      if (channel) channels[channel] = camera.id
    }
    nvrConfig.value = { ...nvrConfig.value, channels }
  }
  sceneEnvironment.value = environment
  try { localStorage.setItem(environmentStorageKey, environment) } catch { /* The scene still works for this session. */ }
}
function flushSetupStreams() {
  bus.flush('Configuration changed during an incomplete camera-bus packet.').forEach(addEntry); pending.value = []
  nvrStream.flush('Configuration changed during an incomplete NVR packet.').forEach(event => addNvrEntry(event)); nvrPending.value = []; nvrCommandId = undefined
}
function resetSimulationDefaults() {
  if (isReplaying.value) return
  emergencyStop()
  setupBeforeReset = { cameras: cameras.value, switchers: switchers.value, config: nvrConfig.value, nvr: { channel: nvr.channel, layout: nvr.layout }, cameraId: selectedCameraId.value, baud: busBaudRate.value }
  flushSetupStreams()
  cameras.value = createDefaultCameras(); selectedCameraId.value = cameras.value[0].id
  switchers.value = [createSwitcher()]; nvrConfig.value = createDefaultNvrConfig()
  Object.assign(nvr, createNvr())
  scene.value?.resetView()
  if (!serialConnected.value) busBaudRate.value = 9600
  defaultsRestored.value = true
}
function undoDefaultReset() {
  if (isReplaying.value) return
  if (!setupBeforeReset) return
  emergencyStop(); flushSetupStreams()
  cameras.value = setupBeforeReset.cameras; selectedCameraId.value = setupBeforeReset.cameraId
  switchers.value = setupBeforeReset.switchers; nvrConfig.value = setupBeforeReset.config
  Object.assign(nvr, createNvr(), setupBeforeReset.nvr)
  if (!serialConnected.value) busBaudRate.value = setupBeforeReset.baud
  dismissDefaultReset()
}
function dismissDefaultReset() { setupBeforeReset = undefined; defaultsRestored.value = false }
const tab = ref('hex')
const input = ref('FF 01 00 02 20 00 23')
const inputError = ref('')
const entries = ref<Entry[]>([])
const busSelection = ref<Entry>()
const cameraSelections = reactive<Record<number, number>>({})
const selectedNvrId = ref<number>()
const captureEntries = computed(() => activeSimulator.value === 'camera' ? cameraHistory(entries.value, address.value) : entries.value.filter(entry => entry.protocol !== 'nvr'))
const captureStats = computed(() => captureSummary(captureEntries.value))
const selected = computed<Entry | undefined>({
  get: () => {
    const id = activeSimulator.value === 'camera' ? cameraSelections[address.value] : busSelection.value?.id
    return captureEntries.value.find(entry => entry.id === id) ?? captureEntries.value[0]
  },
  set: entry => {
    if (!entry || entry.protocol === 'nvr') return
    busSelection.value = entry
    const target = pelcoAddress(entry)
    if (target !== undefined) cameraSelections[target] = entry.id
  },
})
const filter = ref('all')
const showFrustum = ref(true)
const scene = ref<InstanceType<typeof CameraScene>>()
const ports = ref<SerialPortInfo[]>([])
const refreshingPorts = ref(false); const portsError = ref('')
const serialPath = ref(''); const baudRate = ref(9600)
const serialConnected = ref(false); const connectedPath = ref('')
const bridgeConnected = ref(false); const connectionError = ref(''); const busy = ref(false)
const bus = new SharedSerialBus()
const pending = ref<number[]>([])
const nvrStream = new NvrStream()
const nvrPending = ref<number[]>([])
const nvrConnected = ref(false); const nvrPath = ref(''); const nvrLineBaud = ref(9600)
const nvrSerialPath = ref(''); const nvrBaudRate = ref(9600)
const nvrBusy = ref(false); const nvrError = ref('')
let nvrSource = 'nvr-api'
let nvrCommandId: string | undefined
let socket: WebSocket | undefined; let reconnect: ReturnType<typeof setTimeout> | undefined
let frame = 0; let sequence = 0; let disposed = false
let held: string | null = null; let repeat: ReturnType<typeof setInterval> | undefined
const panSpeed = ref(32); const tiltSpeed = ref(24); const preset = ref(1)
const visibleEntries = computed(() => captureEntries.value.filter(entry => filter.value === 'all' || entry.issues.some(issue => issue.severity !== 'info')))
const displayPan = computed(() => ((camera.value.pan - camera.value.zeroPan) % 360 + 360) % 360)
const rates = computed(() => cameraRates(camera.value, profile))
const moving = computed(() => camera.value.target ? 'Moving to preset' : camera.value.scanning ? 'Auto scan' : [camera.value.motion.pan ? `Pan ${camera.value.motion.pan > 0 ? 'right' : 'left'}` : '', camera.value.motion.tilt ? `Tilt ${camera.value.motion.tilt > 0 ? 'up' : 'down'}` : '', camera.value.motion.zoom ? `Zoom ${camera.value.motion.zoom > 0 ? 'tele' : 'wide'}` : '', camera.value.motion.focus ? 'Focus' : '', camera.value.motion.iris ? 'Iris' : ''].filter(Boolean).join(' · ') || 'Stationary')
function entryTone(entry: Entry) { return entry.issues.some(issue => issue.severity === 'error') ? 'error' : entry.issues.some(issue => issue.severity === 'warning') ? 'warning' : ['Ignored', 'No device', 'No preset'].includes(entry.result) ? 'neutral' : 'success' }
function addEntry(event: BusStreamEvent) {
  const dispatched = event.issue ? undefined : dispatchPacket(event.bytes, cameras.value, switchers.value, busSettings.value, simulationClock.now)
  const packet = dispatched?.packet
  const result = dispatched?.result ?? (event.issue?.severity === 'warning' ? 'Bus warning' : 'Rejected')
  const entry: Entry = { id: ++sequence, time: captureTime(), source: event.source, bytes: event.bytes, issues: packet?.issues ?? [event.issue!], packet, description: packet?.description ?? (event.issue?.severity === 'warning' ? 'Interleaving detected' : 'Framing error'), result, deliveries: dispatched?.deliveries ?? [] }
  entries.value.unshift(entry); entries.value = entries.value.slice(0, 200)
  selected.value = entry
}
function receive(bytes: number[], source: string, complete = false, playback = false) {
  if (isReplaying.value && !playback) { skippedLiveInput.value++; return }
  if (!playback) { syncLiveTime(); recordSessionEvent({ type: 'bytes', line: 'camera', bytes: [...bytes], source, complete }) }
  bus.receive(bytes, source, complete, simulationClock.now).forEach(addEntry)
  pending.value = bus.pending
}
function addNvrEntry(event: { bytes: number[]; issue?: import('./protocol/pelcoD').Issue }, source = nvrSource) {
  const packet = event.issue ? undefined : decodeNvr(event.bytes)
  let result = packet ? 'Ignored' : 'Rejected'
  if (packet) {
    if (packet.valid && effectiveNvrBaud !== null && effectiveNvrBaud !== nvrConfig.value.baudRate) {
      result = 'Baud mismatch'
      packet.issues.push({ severity: 'warning', message: `NVR expects ${nvrConfig.value.baudRate} baud; the connected line is ${effectiveNvrBaud}. Command ignored.`, bytes: [1, 2] })
    } else result = applyNvrPacket(nvr, packet, simulationClock.now, Boolean(nvrCommandId))
  }
  const description = packet?.description ?? 'NVR framing error'
  const entry: Entry = { id: ++sequence, time: captureTime(), source, bytes: event.bytes, issues: packet?.issues ?? [event.issue!], description, result, protocol: 'nvr', deliveries: [{ id: 'nvr', name: nvrConfig.value.name, kind: 'nvr', result, detail: description }] }
  entries.value.unshift(entry); entries.value = entries.value.slice(0, 200)
}
function receiveNvr(bytes: number[], source = 'nvr-controls', complete = false, commandId?: string, playback = false) {
  if (isReplaying.value && !playback) { skippedLiveInput.value++; return }
  if (!playback) { syncLiveTime(); recordSessionEvent({ type: 'bytes', line: 'nvr', bytes: [...bytes], source, complete, commandId, baud: effectiveNvrBaud }) }
  nvrSource = source
  if (commandId !== nvrCommandId && nvrStream.pending.length) nvrStream.flush('New NVR command interrupted an incomplete packet.').forEach(event => addNvrEntry(event, source))
  if (complete || commandId !== nvrCommandId) nvr.lastDigit = undefined
  nvrCommandId = commandId
  nvrStream.push(bytes, simulationClock.now).forEach(event => addNvrEntry(event, source))
  if (complete) { nvrStream.flush().forEach(event => addNvrEntry(event, source)); nvr.lastDigit = undefined }
  nvrPending.value = nvrStream.pending
}
function inspectNvr(entry: Entry) { selectedNvrId.value = entry.id; activeSimulator.value = 'overview'; void requestAnimationFrame(() => document.getElementById('overview-nvr-history')?.scrollIntoView({ behavior: 'smooth', block: 'start' })) }
function submit() {
  try { inputError.value = ''; receive(parseHex(input.value), 'manual', true) }
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
  receive(bytes, 'controls', true)
}
function routeSwitcher(device: Switcher, output: number, input: number) { receive(makePacket(device.address, 0, 0x0d, output, input), 'switch-controls', true) }
function injectFault(kind: string, switcherId: string) {
  const device = switchers.value.find(item => item.id === switcherId && item.enabled)
  if (!device) return
  const start = sequence
  const pan = makePacket(address.value, 0, 2, 32)
  const route = makePacket(device.address, 0, 0x0d, 1, device.inputs.length > 1 ? 2 : 1)
  const stop = makePacket(address.value)
  if (kind === 'mixed') receive([...pan, ...route, ...stop], 'bus-example', true)
  else if (kind === 'interleaved') {
    receive(pan.slice(0, 3), 'camera-sender')
    receive(route, 'switch-sender')
    receive([...pan.slice(3), ...stop], 'camera-sender', true)
  } else {
    const corrupt = kind === 'checksum' ? [...route.slice(0, 6), route[6] ^ 0x01] : route.filter((_, i) => i !== 4)
    receive([...corrupt, ...stop], 'fault-injector', true)
  }
  if (kind !== 'mixed') selected.value = entries.value.find(entry => entry.id > start && entry.issues.some(issue => issue.severity === 'error')) ?? selected.value
}
function selectThermalPalette() { localCommand(0, 7, 0, findPalette(camera.value.thermalPalette).preset) }
function toggleLamp() {
  localCommand(0, 7, 0, 90)
  localCommand(0, 7, 0, camera.value.lampOn ? 3 : 4)
}
function resetFeatures() {
  camera.value.thermalEnabled = false; camera.value.thermalPalette = 'white-hot'; camera.value.thermalInverted = false
  camera.value.lampOn = false; camera.value.lampArmedUntil = 0
}
function beginHold(direction: string, event: PointerEvent) {
  if (isReplaying.value) return
  if (event.button !== 0 || held) return
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  held = direction
  const send = () => {
    const bits: Record<string, number> = { left: 4, right: 2, up: 8, down: 16, tele: 32, wide: 64, 'focus-near': 0, 'focus-far': 128 }
    localCommand(direction === 'focus-near' ? 1 : 0, bits[direction], ['left', 'right'].includes(direction) ? (panSpeed.value === 64 ? turboByte.value : panSpeed.value) : 0, ['up', 'down'].includes(direction) ? tiltSpeed.value : 0)
  }
  send(); repeat = setInterval(send, 150)
}
function endHold() { if (!held) return; clearInterval(repeat); held = null; localCommand() }
function emergencyStop() {
  if (isReplaying.value) return
  endHold()
  for (const target of new Set(cameras.value.map(item => item.address))) receive(makePacket(target), 'controls', true)
  cameras.value.forEach(item => stopCamera(item.state))
}
function resetCamera() {
  if (isReplaying.value) return
  endHold(); stopCamera(camera.value)
  camera.value.pan = 0; camera.value.tilt = 0; camera.value.zoom = 1; camera.value.focus = 0.5; camera.value.iris = 0.7; camera.value.power = true; camera.value.watchdogStopped = false; camera.value.zeroPan = 0; camera.value.autofocus = true
  resetFeatures()
  scene.value?.resetView()
  recordStateChange('Reset camera')
}
function changeAddress() {
  if (isReplaying.value) return
  address.value = Math.min(255, Math.max(1, Math.round(Number(address.value) || 1)))
  endHold(); stopCamera(camera.value); camera.value.presets.clear()
  resetFeatures()
  bus.flush('Address changed while receiving an incomplete packet.').forEach(addEntry)
  pending.value = []
}
async function request(path: string, body?: object) {
  const response = await fetch(`/api/${path}`, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined)
  const result = await response.json()
  if (!response.ok) throw new Error(result.error ?? 'Bridge request failed.')
  return result
}
async function refreshPorts() {
  if (refreshingPorts.value) return
  refreshingPorts.value = true; portsError.value = ''
  try { ports.value = await request('ports') }
  catch (error) { portsError.value = error instanceof Error ? error.message : 'Cannot list serial ports.' }
  finally { refreshingPorts.value = false }
}
async function toggleSerial(path: string, rate: number) {
  busy.value = true; connectionError.value = ''
  serialPath.value = path; baudRate.value = rate
  try { cameraSerialStatus(await request(serialConnected.value ? 'disconnect' : 'connect', serialConnected.value ? {} : { path, baudRate: rate })) }
  catch (error) { connectionError.value = error instanceof Error ? error.message : 'Serial connection failed.' }
  finally { busy.value = false }
}
async function toggleNvrSerial(path: string, baudRate: number) {
  nvrBusy.value = true; nvrError.value = ''
  nvrSerialPath.value = path; nvrBaudRate.value = baudRate
  try { nvrSerialStatus(await request(nvrConnected.value ? 'nvr/disconnect' : 'nvr/connect', nvrConnected.value ? {} : { path, baudRate })) }
  catch (error) { nvrError.value = error instanceof Error ? error.message : 'NVR serial connection failed.' }
  finally { nvrBusy.value = false }
}
function cameraSerialStatus(message: { connected: boolean; path: string; baudRate: number }) {
  if (isReplaying.value) { serialConnected.value = message.connected; connectedPath.value = message.path; return }
  syncLiveTime()
  if (serialConnected.value && (!message.connected || message.path !== connectedPath.value)) {
    bus.flush('Serial device disconnected during a packet.').forEach(addEntry); cameras.value.forEach(item => stopCamera(item.state))
  }
  serialConnected.value = message.connected; connectedPath.value = message.path
  if (message.connected) { busBaudRate.value = message.baudRate; serialPath.value = message.path; baudRate.value = message.baudRate }
  pending.value = bus.pending
  recordStateChange('Camera serial connection changed')
}
function nvrSerialStatus(message: { connected: boolean; path: string; baudRate: number }) {
  if (isReplaying.value) { nvrConnected.value = message.connected; nvrPath.value = message.path; nvrLineBaud.value = message.baudRate; return }
  syncLiveTime()
  if (nvrConnected.value && (!message.connected || message.path !== nvrPath.value)) {
    nvrStream.flush('NVR serial device disconnected during a packet.').forEach(event => addNvrEntry(event)); nvr.heldKeys.clear(); nvr.lastDigit = undefined
  }
  nvrConnected.value = message.connected; nvrPath.value = message.path; nvrLineBaud.value = message.baudRate
  if (message.connected) { nvrSerialPath.value = message.path; nvrBaudRate.value = message.baudRate }
  nvrPending.value = nvrStream.pending
  effectiveNvrBaud = message.connected ? message.baudRate : null
  recordStateChange('NVR serial connection changed')
}
function connectBridge() {
  socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/serial`)
  socket.onopen = () => { bridgeConnected.value = true; connectionError.value = '' }
  socket.onmessage = event => {
    const message = JSON.parse(event.data)
    if (message.type === 'status') cameraSerialStatus(message)
    else if (message.type === 'nvr-status') nvrSerialStatus(message)
    else if (message.type === 'bytes') {
      if (message.line === 'nvr') receiveNvr(message.bytes, `nvr-${message.source}`, false, message.commandId)
      else receive(message.bytes, message.source)
    } else if (message.type === 'error') {
      if (message.line === 'nvr') nvrError.value = message.message
      else connectionError.value = message.message
    }
  }
  socket.onclose = () => {
    bridgeConnected.value = false; serialConnected.value = false; nvrConnected.value = false
    if (!isReplaying.value) {
      bus.flush('Bridge disconnected during a packet.').forEach(addEntry)
      pending.value = []; cameras.value.forEach(item => stopCamera(item.state))
      nvrStream.flush('Bridge disconnected during an NVR packet.').forEach(event => addNvrEntry(event)); nvrPending.value = []; nvr.heldKeys.clear(); nvr.lastDigit = undefined
      effectiveNvrBaud = null; recordStateChange('Serial bridge disconnected')
    }
    if (!disposed) { connectionError.value = 'Serial bridge offline. Reconnecting…'; reconnect = setTimeout(connectBridge, 2000) }
  }
}
function exportLog() {
  const blob = new Blob([JSON.stringify(captureEntries.value.slice().reverse(), null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob); const link = document.createElement('a')
  link.href = url; link.download = activeSimulator.value === 'camera' ? `iris-camera-${address.value}-pelco-capture.json` : 'iris-pelco-capture.json'; link.click(); URL.revokeObjectURL(url)
}
function clearLog() {
  const ids = new Set(captureEntries.value.map(entry => entry.id))
  entries.value = entries.value.filter(entry => !ids.has(entry.id))
  if (activeSimulator.value === 'camera') delete cameraSelections[address.value]
  if (busSelection.value && ids.has(busSelection.value.id)) busSelection.value = undefined
}
function clearNvrLog() { entries.value = entries.value.filter(entry => entry.protocol !== 'nvr'); selectedNvrId.value = undefined }
const savedSessions = shallowRef<RecordedSession[]>([])
const sessionSelection = ref('')
const sessionName = ref('Yacht session')
const sessionPosition = ref(0); const sessionDuration = ref(0); const sessionEventCount = ref(0)
const replaySpeed = ref(1); const skippedLiveInput = ref(0); const sessionError = ref('')
let recording: RecordedSession | undefined
let playback: SessionPlayback | undefined
let liveBeforeReplay: { snapshot: SessionSnapshot; entries: Entry[]; cameraConnected: boolean } | undefined
let effectiveNvrBaud: number | null = null
let previousLiveTime = performance.now(); let stepRemainder = 0
function captureTime() { return new Date(simulationClock.now).toLocaleTimeString('en-GB', { hour12: false }) + '.' + String(Math.floor(simulationClock.now) % 1000).padStart(3, '0') }
function sessionSnapshot(): SessionSnapshot {
  return JSON.parse(JSON.stringify({ now: simulationClock.now, seconds: simulationClock.seconds,
    cameras: cameras.value.map(item => ({ ...item, state: { ...item.state, presets: [...item.state.presets] } })),
    switchers: switchers.value, config: nvrConfig.value, profile, nvr: { ...nvr, heldKeys: [...nvr.heldKeys] },
    environment: sceneEnvironment.value, timeOfDay: timeOfDay.value, waves: waveStrength.value, thermal: thermalSettings,
    cameraId: selectedCameraId.value, baud: busBaudRate.value, turbo: turboByte.value, nvrInputBaud: effectiveNvrBaud,
    bus: bus.snapshot(), nvrStream: nvrStream.snapshot(), nvrSource, nvrCommandId,
  }))
}
function restoreSession(snapshot: SessionSnapshot) {
  restoringSession = true
  const saved: SessionSnapshot = JSON.parse(JSON.stringify(snapshot))
  simulationClock.restore(saved.now, saved.seconds); stepRemainder = 0
  cameras.value = saved.cameras.map(item => ({ ...item, state: { ...item.state, presets: new Map(item.state.presets) } }))
  switchers.value = saved.switchers; nvrConfig.value = saved.config
  Object.assign(nvr, createNvr(), saved.nvr, { heldKeys: new Map(saved.nvr.heldKeys) })
  nvr.lastDigit = saved.nvr.lastDigit
  Object.assign(profile, saved.profile); Object.assign(thermalSettings, saved.thermal)
  sceneEnvironment.value = saved.environment; timeOfDay.value = saved.timeOfDay; waveStrength.value = saved.waves
  selectedCameraId.value = saved.cameraId; busBaudRate.value = saved.baud; turboByte.value = saved.turbo; effectiveNvrBaud = saved.nvrInputBaud
  bus.restore(saved.bus); nvrStream.restore(saved.nvrStream); nvrSource = saved.nvrSource; nvrCommandId = saved.nvrCommandId
  pending.value = bus.pending; nvrPending.value = nvrStream.pending
  restoringSession = false
}
function advanceScene(milliseconds: number) {
  stepRemainder += milliseconds
  while (stepRemainder + 0.00001 >= simulationStep) {
    simulationClock.advance(simulationStep); stepRemainder = Math.max(0, stepRemainder - simulationStep)
    cameras.value.forEach(device => stepCamera(device.state, profile, simulationStep / 1000, simulationClock.now))
    bus.expire(simulationClock.now).forEach(addEntry); nvrStream.expire(simulationClock.now).forEach(event => addNvrEntry(event))
  }
  pending.value = bus.pending; nvrPending.value = nvrStream.pending
}
function syncLiveTime() {
  const now = performance.now(); const elapsed = now - previousLiveTime; previousLiveTime = now
  if (!isReplaying.value) advanceScene(elapsed)
}
function recordSessionEvent(event: Omit<Extract<SessionEvent, { type: 'bytes' }>, 'at'> | Omit<Extract<SessionEvent, { type: 'state' }>, 'at'>) {
  if (!recording || restoringSession || isReplaying.value) return
  const at = Math.max(0, (simulationClock.seconds - recording.initial.seconds) * 1000)
  if (recording.events.length >= maxSessionEvents || at > maxSessionDuration) { stopRecording(); sessionError.value = 'Recording saved: the two-hour or 50,000-event limit was reached.'; return }
  recording.events.push({ ...event, at }); sessionEventCount.value = recording.events.length
}
function recordStateChange(label: string) {
  if (!recording || isReplaying.value || restoringSession) return
  const snapshot = sessionSnapshot()
  // Text fields can briefly be empty while a user edits a valid device setup.
  try { parseSession(JSON.stringify({ ...recording, initial: snapshot, events: [], duration: 0 })) } catch { return }
  recordSessionEvent({ type: 'state', snapshot, label })
}
watch(() => JSON.stringify({ cameraId: selectedCameraId.value, cameras: cameras.value.map(({ state, ...config }) => config), switchers: switchers.value, config: nvrConfig.value, profile, thermal: thermalSettings, environment: sceneEnvironment.value, lighting: timeOfDay.value, waves: waveStrength.value, baud: busBaudRate.value, turbo: turboByte.value }), () => recordStateChange('Simulation settings changed'))
function saveSession(session: RecordedSession) {
  savedSessions.value = [session, ...savedSessions.value.filter(item => item.id !== session.id)].slice(0, 10)
  sessionSelection.value = session.id
  try { localStorage.setItem(sessionStorageKey, JSON.stringify(savedSessions.value)) }
  catch { sessionError.value = 'Recording is available in this tab, but browser storage is full. Export it to keep a copy.' }
}
function startRecording() {
  if (isReplaying.value || recording) return
  endHold(); syncLiveTime(); stepRemainder = 0; sessionError.value = ''
  const name = sessionName.value.trim().slice(0, 80) || 'Untitled session'; sessionName.value = name
  recording = { format: 'iris-session', version: 1, id: crypto.randomUUID(), name, createdAt: new Date().toISOString(), duration: 0, initial: sessionSnapshot(), events: [] }
  try { parseSession(JSON.stringify(recording)) }
  catch { recording = undefined; sessionError.value = 'Finish editing the device settings before starting a recording.'; return }
  sessionPosition.value = 0; sessionDuration.value = 0; sessionEventCount.value = 0; sessionMode.value = 'recording'
}
function stopRecording() {
  if (!recording) return
  syncLiveTime(); recording.duration = Math.min(maxSessionDuration, Math.max(0, (simulationClock.seconds - recording.initial.seconds) * 1000))
  const saved = recording; recording = undefined; sessionMode.value = 'live'; sessionDuration.value = saved.duration
  saveSession(saved)
}
function applySessionEvent(event: SessionEvent) {
  if (event.type === 'state') restoreSession(event.snapshot)
  else if (event.line === 'camera') receive(event.bytes, event.source, event.complete, true)
  else { effectiveNvrBaud = event.baud ?? null; receiveNvr(event.bytes, event.source, event.complete, event.commandId, true) }
}
function playSession() {
  if (recording) return
  if (playback) {
    if (playback.position >= playback.session.duration) playback.seek(0)
    sessionMode.value = 'playing'; return
  }
  const selected = savedSessions.value.find(item => item.id === sessionSelection.value)
  if (!selected) return
  endHold(); syncLiveTime(); liveBeforeReplay = { snapshot: sessionSnapshot(), entries: entries.value, cameraConnected: serialConnected.value }
  sessionMode.value = 'paused'; sessionError.value = ''; skippedLiveInput.value = 0; entries.value = []; busSelection.value = undefined
  playback = new SessionPlayback(selected, { restore: restoreSession, advance: advanceScene, event: applySessionEvent })
  playback.seek(0); sessionDuration.value = selected.duration; sessionPosition.value = 0; sessionEventCount.value = selected.events.length
  sessionMode.value = 'playing'
}
function seekSession(value: number) {
  if (!playback) return
  sessionMode.value = 'paused'; entries.value = []; busSelection.value = undefined
  playback.seek(Math.max(0, Math.min(value, playback.session.duration))); sessionPosition.value = playback.position
}
function returnToLive() {
  if (!liveBeforeReplay) return
  restoreSession(liveBeforeReplay.snapshot); entries.value = liveBeforeReplay.entries
  // A hardware disconnect while replaying must not resume stale motion.
  if (liveBeforeReplay.cameraConnected && (!bridgeConnected.value || !serialConnected.value)) cameras.value.forEach(device => stopCamera(device.state))
  liveBeforeReplay = undefined; playback = undefined
  effectiveNvrBaud = nvrConnected.value ? nvrLineBaud.value : null
  previousLiveTime = performance.now(); sessionMode.value = 'live'
}
function exportSession() {
  const session = savedSessions.value.find(item => item.id === sessionSelection.value)
  if (!session) return
  const url = URL.createObjectURL(new Blob([JSON.stringify(session)], { type: 'application/json' }))
  const link = document.createElement('a'); link.href = url; link.download = `iris-session-${session.name.replace(/[^a-z0-9_-]+/gi, '-').slice(0, 60)}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
}
async function importSession(file: File) {
  if (isReplaying.value || recording) return
  sessionError.value = ''
  try { if (file.size > 12_000_000) throw new Error('Session files must be smaller than 12 MB.'); saveSession(parseSession(await file.text())) }
  catch (error) { sessionError.value = error instanceof Error ? error.message : 'Cannot import this session.' }
}
function blockReplayChanges(event: Event) {
  if (!isReplaying.value || !(event.target instanceof Element)) return
  if (event.target.closest('.camera-controls, .camera-effects, .focus-controls, .thermal-controls, .input-panel, .settings-panel, .nvr-controls, .video-wiring, .nvr-serial, .camera-editor-actions, .overview-actions, .switcher-editor, .switcher-heading, .switcher-actions, .switcher-config, .switcher-card input, .switcher-card select')) { event.preventDefault(); event.stopImmediatePropagation() }
}
function onVisibility() { if (document.hidden) endHold() }
onMounted(() => {
  try {
    const saved = JSON.parse(localStorage.getItem(sessionStorageKey) ?? '[]')
    if (Array.isArray(saved)) savedSessions.value = saved.slice(0, 10).flatMap(item => { try { return [parseSession(JSON.stringify(item))] } catch { return [] } })
    sessionSelection.value = savedSessions.value[0]?.id ?? ''
  } catch { sessionError.value = 'Saved recordings could not be loaded. You can still record or import a session.' }
  connectBridge(); refreshPorts()
  let previous = performance.now()
  const animate = (now: number) => {
    const elapsed = now - previous; previous = now
    if (sessionMode.value === 'playing' && playback) {
      playback.advance(elapsed * replaySpeed.value); sessionPosition.value = playback.position
      if (playback.position >= playback.session.duration) sessionMode.value = 'paused'
      previousLiveTime = now
    } else if (!isReplaying.value) {
      syncLiveTime()
      if (recording) {
        sessionDuration.value = Math.max(0, (simulationClock.seconds - recording.initial.seconds) * 1000)
        if (sessionDuration.value >= maxSessionDuration) stopRecording()
      }
    } else previousLiveTime = now
    frame = requestAnimationFrame(animate)
  }
  frame = requestAnimationFrame(animate)
  window.addEventListener('blur', endHold); document.addEventListener('visibilitychange', onVisibility); document.addEventListener('keydown', onLightingKey)
})
onUnmounted(() => {
  if (recording) stopRecording()
  disposed = true; clearTimeout(reconnect); clearInterval(repeat)
  cancelAnimationFrame(frame); socket?.close(); window.removeEventListener('blur', endHold); document.removeEventListener('visibilitychange', onVisibility); document.removeEventListener('keydown', onLightingKey)
})
</script>

<template>
  <div class="app-shell" :class="{ 'is-replaying': isReplaying }">
    <header class="topbar">
      <a class="brand" href="/" aria-label="IRIS Simulators home"><span class="brand-mark"><i></i><i></i><i></i><i></i></span><strong>IRIS<span> / </span>SIMULATORS</strong></a>
      <div class="simulator-tabs" role="tablist" aria-label="Simulator"><button id="overview-tab" :class="{ active: activeSimulator === 'overview' }" role="tab" :aria-selected="activeSimulator === 'overview'" aria-controls="overview-simulator" @click="activeSimulator = 'overview'"><span>▦</span> Overview</button><button id="camera-tab" :class="{ active: activeSimulator === 'camera' }" role="tab" :aria-selected="activeSimulator === 'camera'" aria-controls="camera-simulator" @click="activeSimulator = 'camera'"><span>◈</span> PTZ camera</button><button id="switcher-tab" :class="{ active: activeSimulator === 'switchers' }" role="tab" :aria-selected="activeSimulator === 'switchers'" aria-controls="switcher-simulator" @click="activeSimulator = 'switchers'"><span>⇄</span> Monitor switching <small>{{ switchers.length }}</small></button><button id="monitors-tab" :class="{ active: activeSimulator === 'monitors' }" role="tab" :aria-selected="activeSimulator === 'monitors'" aria-controls="monitor-simulator" @click="activeSimulator = 'monitors'"><span>▤</span> Simulation</button></div>
      <div class="header-status"><SerialSourceMenu :inert="isReplaying" :ports="ports" :refreshing="refreshingPorts" :ports-error="portsError" :bridge-connected="bridgeConnected" v-model:camera-path="serialPath" v-model:camera-baud="baudRate" :camera-connected="serialConnected" :camera-connected-path="connectedPath" :camera-busy="busy" :camera-error="connectionError" v-model:nvr-path="nvrSerialPath" v-model:nvr-baud="nvrBaudRate" :nvr-connected="nvrConnected" :nvr-connected-path="nvrPath" :nvr-busy="nvrBusy" :nvr-error="nvrError" @camera="toggleSerial" @nvr="toggleNvrSerial" @refresh="refreshPorts" /><div class="bridge-status" :aria-label="bridgeConnected ? 'Bridge online' : 'Bridge offline'"><i class="status-dot" :class="{ offline: !bridgeConnected }"></i><span class="bridge-label">{{ bridgeConnected ? 'Bridge online' : 'Bridge offline' }}</span><span class="version">v0.1</span></div></div>
    </header>

    <div class="environment-toolbar" :inert="isReplaying">
      <div class="environment-picker" role="group" aria-label="3D environment"><span>3D ENVIRONMENT</span><div class="view-mode"><button type="button" :class="{ active: sceneEnvironment === 'vista' }" :aria-pressed="sceneEnvironment === 'vista'" @click="changeEnvironment('vista')">◈ Calibration vista</button><button type="button" :class="{ active: sceneEnvironment === 'yacht' }" :aria-pressed="sceneEnvironment === 'yacht'" @click="changeEnvironment('yacht')">⌁ Mega yacht</button></div></div>
      <label v-if="sceneEnvironment === 'yacht'" class="yacht-location-picker">Inspect location<select :value="selectedCameraId" aria-label="Inspect yacht camera location" @change="selectCamera(($event.target as HTMLSelectElement).value, true)"><option v-for="(item, i) in cameras" :key="item.id" :value="item.id">{{ yachtMountFor(item, i).name }} · ADDR {{ item.address }}</option></select></label>
      <div class="view-mode daylight-picker" role="group" aria-label="Time of day" title="D: day · G: golden hour · N: night · T: toggle day/night"><button type="button" :class="{ active: timeOfDay === 'day' }" :aria-pressed="timeOfDay === 'day'" aria-keyshortcuts="D" title="Day (D) · Toggle day/night with T" @click="timeOfDay = 'day'">☀ Day <kbd>D</kbd></button><button type="button" :class="{ active: timeOfDay === 'golden-hour' }" :aria-pressed="timeOfDay === 'golden-hour'" aria-keyshortcuts="G" title="Golden hour (G)" @click="timeOfDay = 'golden-hour'">🌅 Golden hour <kbd>G</kbd></button><button type="button" :class="{ active: night }" :aria-pressed="night" aria-keyshortcuts="N" title="Night (N) · Toggle day/night with T" @click="timeOfDay = 'night'">☾ Night <kbd>N</kbd></button></div>
      <label v-if="sceneEnvironment === 'yacht'" class="wave-strength-picker">Waves <input v-model.number="waveStrength" type="range" min="0" max="2" step="0.05" aria-label="Wave strength" :aria-valuetext="waveStrength === 0 ? 'Calm' : `${Math.round(waveStrength * 100)} percent`" /><output>{{ waveStrength === 0 ? 'Calm' : `${Math.round(waveStrength * 100)}%` }}</output></label>
      <span class="environment-note">{{ sceneEnvironment === 'yacht' ? 'Island cruise · skyline & Spinnaker Tower · 8 km visibility' : 'Original calibration targets · live camera feeds' }}</span>
    </div>

    <SessionRecorder :mode="sessionMode" :sessions="savedSessions" :selected="sessionSelection" :name="sessionName" :position="sessionPosition" :duration="sessionDuration" :events="sessionEventCount" :speed="replaySpeed" :ignored="skippedLiveInput" :error="sessionError" @record="startRecording" @stop="stopRecording" @play="playSession" @pause="sessionMode = 'paused'" @live="returnToLive" @seek="seekSession" @export="exportSession" @import="importSession" @select="sessionSelection = $event" @name="sessionName = $event" @speed="replaySpeed = $event" />

    <main :class="{ 'overview-main': ['overview', 'monitors'].includes(activeSimulator) }" @click.capture="blockReplayChanges" @input.capture="blockReplayChanges" @change.capture="blockReplayChanges" @pointerdown.capture="blockReplayChanges">
      <div v-if="['camera', 'switchers'].includes(activeSimulator)" class="page-heading"><div><div class="eyebrow">IRIS SYSTEMS <span>/</span> SERIAL PROTOCOLS</div><h1>{{ activeSimulator === 'camera' ? 'Pelco-D' : 'Monitor switching' }} <span>simulator</span><span class="protocol-badge">SHARED SERIAL BUS</span></h1><p>Watch camera motion and monitor routes respond to the same command stream.</p></div><button class="button danger-outline" @click="emergencyStop"><span class="stop-square"></span> Stop all cameras</button></div>

      <SimulatorOverview v-if="activeSimulator === 'overview'" id="overview-simulator" :environment="sceneEnvironment" :night="night" :time-of-day="timeOfDay" :wave-strength="waveStrength" :cameras="cameras" :switchers="switchers" :entries="entries" :selected-nvr-id="selectedNvrId" :settings="busSettings" :pending="pending.length" :storage-error="cameraStorageError" @cameras="updateCameras" @controls="selectCamera($event, true)" @switchers="activeSimulator = 'switchers'" @stop="emergencyStop" @clear-nvr="clearNvrLog" />

      <MonitorSimulation v-if="activeSimulator === 'monitors'" id="monitor-simulator" :replaying="isReplaying" :environment="sceneEnvironment" :night="night" :time-of-day="timeOfDay" :wave-strength="waveStrength" :cameras="cameras" :switchers="switchers" :nvr="nvr" :config="nvrConfig" :entries="entries" :connected="nvrConnected" :path="nvrPath" v-model:serial-path="nvrSerialPath" v-model:serial-baud="nvrBaudRate" :ports="ports" :refreshing="refreshingPorts" :ports-error="portsError" :busy="nvrBusy" :bridge-connected="bridgeConnected" :error="nvrError" :pending="nvrPending.length" :storage-error="nvrStorageError || storageError || cameraStorageError" :defaults-restored="defaultsRestored" @reset="resetSimulationDefaults" @undo-reset="undoDefaultReset" @dismiss-reset="dismissDefaultReset" @bytes="receiveNvr($event, 'nvr-controls', true)" @config="nvrConfig = $event" @switchers="switchers = $event" @route="routeSwitcher" @serial="toggleNvrSerial" @refresh-ports="refreshPorts" @inspect="inspectNvr" @configure-switchers="activeSimulator = 'switchers'" />

      <div v-show="['camera', 'switchers'].includes(activeSimulator)">
      <div class="workbench">
        <section v-show="activeSimulator === 'camera'" id="camera-simulator" class="panel visualization-panel" role="tabpanel" aria-labelledby="camera-tab">
          <div class="panel-heading"><h2><span class="small-icon">◈</span> Camera visualization</h2><select v-if="cameras.length > 1" class="camera-picker" :value="selectedCameraId" aria-label="Camera to control" @change="selectCamera(($event.target as HTMLSelectElement).value)"><option v-for="item in cameras" :key="item.id" :value="item.id">{{ item.name }} · {{ item.address }}</option></select><div class="view-actions"><label><input v-model="showFrustum" type="checkbox" /> Field of view</label><button class="icon-button" @click="scene?.resetView()" aria-label="Reset orbit view" title="Reset orbit view">↻</button></div></div>
          <CameraScene :key="sceneEnvironment" ref="scene" :environment="sceneEnvironment" :night="night" :time-of-day="timeOfDay" :wave-strength="waveStrength" :cameras="cameras" :camera-id="selectedCameraId" :camera="camera" :show-frustum="showFrustum" />
          <div class="telemetry">
            <div><span>PAN ANGLE</span><strong>{{ displayPan.toFixed(1) }}<small>°</small></strong><em>{{ rates.pan.toFixed(1) }}° / s</em></div>
            <div><span>TILT ANGLE</span><strong>{{ camera.tilt.toFixed(1) }}<small>°</small></strong><em>{{ rates.tilt.toFixed(1) }}° / s</em></div>
            <div><span>OPTICAL ZOOM</span><strong>{{ camera.zoom.toFixed(1) }}<small>×</small></strong><em>{{ (100 * zoomSpeedFactor(camera.zoom)).toFixed(0) }}% pan / tilt speed</em></div>
            <div class="motion-telemetry"><span>CAMERA STATE</span><strong :class="{ mint: moving !== 'Stationary' }">{{ moving }}</strong><em>{{ camera.power ? 'Camera on' : 'Camera off' }} · Lens {{ (camera.focus * 100).toFixed(0) }}% / iris {{ (camera.iris * 100).toFixed(0) }}%</em></div>
          </div>
          <div v-if="camera.watchdogStopped" class="inline-warning" role="status">Motion stopped: no fresh motion command within {{ profile.watchdogMs / 1000 }} seconds.</div>
          <div class="camera-controls" :inert="isReplaying">
            <div class="control-label"><strong>Try a movement</strong><span>Hold a control to send commands</span></div>
            <div class="direction-pad"><button v-for="direction in ['left', 'up', 'down', 'right']" :key="direction" class="direction-button" :aria-label="`Hold to ${direction === 'up' || direction === 'down' ? 'tilt' : 'pan'} ${direction}`" @pointerdown="beginHold(direction, $event)" @pointerup="endHold" @pointercancel="endHold" @lostpointercapture="endHold">{{ ({ left: '←', up: '↑', down: '↓', right: '→' } as Record<string, string>)[direction] }}</button></div>
            <div class="zoom-controls"><button class="direction-button" aria-label="Hold to zoom wide" @pointerdown="beginHold('wide', $event)" @pointerup="endHold" @pointercancel="endHold" @lostpointercapture="endHold">−</button><span>ZOOM</span><button class="direction-button" aria-label="Hold to zoom tele" @pointerdown="beginHold('tele', $event)" @pointerup="endHold" @pointercancel="endHold" @lostpointercapture="endHold">+</button></div>
            <button class="text-button reset-button" @click="resetCamera">↻ Reset camera</button>
          </div>
          <div class="camera-effects" :inert="isReplaying">
            <div class="view-mode" role="group" aria-label="Camera view mode"><button :class="{ active: !camera.thermalEnabled }" :aria-pressed="!camera.thermalEnabled" @click="localCommand(0, 7, 0, 226)">Daylight</button><button :class="{ active: camera.thermalEnabled }" :aria-pressed="camera.thermalEnabled" @click="localCommand(0, 7, 0, 229)">Thermal</button></div>
            <label class="palette-select" for="thermal-palette">Thermal palette<select id="thermal-palette" v-model="camera.thermalPalette" @change="selectThermalPalette"><option v-for="palette in thermalPalettes" :key="palette.id" :value="palette.id">{{ palette.name }}</option></select></label>
            <span class="palette-swatch" :style="{ background: paletteGradient(camera.thermalPalette) }" aria-hidden="true"></span>
            <button class="button lamp-button" :class="{ 'lamp-active': camera.lampOn }" :aria-pressed="camera.lampOn" :aria-label="camera.lampOn ? 'Turn lamp off' : 'Turn lamp on'" @click="toggleLamp"><span aria-hidden="true">☀</span> Lamp {{ camera.lampOn ? 'on' : 'off' }}</button>
            <span class="gyro-state" role="status" :class="{ active: camera.gyroOn }" title="Pelco-D call preset 251 enables gyro; 252 disables it. Presets 250/249 trim up/down.">Gyro {{ camera.gyroOn ? 'on · horizon stabilized' : 'off · follows vessel' }}</span>
          </div>
          <div class="focus-controls" :inert="isReplaying">
            <span class="focus-mode">Focus <strong>{{ camera.autofocus ? 'Auto' : `Manual · ${(camera.focus * 100).toFixed(0)}%` }}</strong></span>
            <button class="button secondary" aria-label="Hold to focus near" @pointerdown="beginHold('focus-near', $event)" @pointerup="endHold" @pointercancel="endHold" @lostpointercapture="endHold">Near</button>
            <button class="button secondary" aria-label="Hold to focus far" @pointerdown="beginHold('focus-far', $event)" @pointerup="endHold" @pointercancel="endHold" @lostpointercapture="endHold">Far</button>
            <button class="button secondary" :class="{ 'autofocus-active': camera.autofocus }" :aria-pressed="camera.autofocus" @click="localCommand(0, 0x2b, 0, camera.autofocus ? 1 : 0)">Auto focus</button>
          </div>
          <div v-if="camera.thermalEnabled" class="thermal-controls" :inert="isReplaying">
            <label>Heat map range<select aria-label="Thermal temperature range" :value="thermalRangeIndex" @change="setThermalRange(Number(($event.target as HTMLSelectElement).value))"><option v-for="(range, i) in thermalRanges" :key="i" :value="i">{{ range.name }}</option><option :value="-1" disabled>Custom range</option></select></label>
            <label>Low °C<input :value="thermalSettings.min" type="number" min="-40" :max="thermalSettings.max - 1" aria-label="Thermal range minimum" @change="thermalSettings.min = Math.max(-40, Math.min(thermalSettings.max - 1, Number(($event.target as HTMLInputElement).value) || 0))" /></label>
            <label>High °C<input :value="thermalSettings.max" type="number" :min="thermalSettings.min + 1" max="200" aria-label="Thermal range maximum" @change="thermalSettings.max = Math.min(200, Math.max(thermalSettings.min + 1, Number(($event.target as HTMLInputElement).value) || 45))" /></label>
            <label>Air °C<input :value="thermalSettings.air" type="number" min="-20" max="50" aria-label="Ambient air temperature" @change="thermalSettings.air = Math.max(-20, Math.min(50, Number(($event.target as HTMLInputElement).value) || 0))" /></label>
            <label>Sea °C<input :value="thermalSettings.water" type="number" min="-2" max="40" aria-label="Sea temperature" @change="thermalSettings.water = Math.max(-2, Math.min(40, Number(($event.target as HTMLInputElement).value) || 0))" /></label>
          </div>
          <div class="camera-effects-note">Thermal heat maps simulate surface temperature, emissivity, reflected sky, sun warming and atmospheric attenuation. Glass and hulls remain opaque. The scale shows simulated apparent °C; focus affects both views.</div>
        </section>

        <MonitorSwitchers :inert="isReplaying" v-show="activeSimulator === 'switchers'" id="switcher-simulator" role="tabpanel" aria-labelledby="switcher-tab" :switchers="switchers" :storage-error="storageError" :first-camera-id="cameras[0].id" @update="switchers = $event" @route="routeSwitcher" />

        <aside class="panel input-panel" :inert="isReplaying">
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
              <SerialConnection line="camera" :ports="ports" v-model:path="serialPath" v-model:baud-rate="baudRate" :connected="serialConnected" :connected-path="connectedPath" :busy="busy" :bridge-connected="bridgeConnected" :error="connectionError" :refreshing="refreshingPorts" :ports-error="portsError" @toggle="toggleSerial" @refresh="refreshPorts" />
              <div class="serial-note">Connect a USB serial adapter, or enter a virtual serial port path to receive bytes from your controller. Camera and switcher traffic share one parser. The bridge receives only; it sends no device replies.</div>
              <details class="api-details"><summary>Send bytes from another app</summary><p>While this UI is open, POST binary bytes to <code>http://127.0.0.1:4311/api/bytes</code> with <code>Content-Type: application/octet-stream</code>, or JSON <code>{"hex":"FF 01 00 02 20 00 23"}</code>.</p></details>
            </template>
          </div>
          <div class="profile-note"><i>ⓘ</i><p>{{ turboByte === 255 ? 'IRIS / legacy' : 'Pelco v5.2.2' }} PTZ profile<span>At 1×: pan {{ profile.maxPanSpeed }}°/s · turbo {{ profile.turboPanSpeed }}°/s · tilt {{ profile.maxTiltSpeed }}°/s<br>Pan and tilt slow proportionally as zoom increases.</span></p></div>
        </aside>
      </div>

      <SharedBusPanel :settings="busSettings" :switchers="switchers" :deliveries="selected?.deliveries ?? []" :serial-connected="serialConnected" :pending="pending.length" :command="selected?.description ?? ''" @baud="busBaudRate = $event" @camera-baud="cameraBaudRate = $event" @fault="injectFault" />

      <PacketInspector :entry="selected" :heading="activeSimulator === 'camera' ? `Pelco-D packet inspector · ADDR ${address}` : undefined" />

      <section class="panel capture-panel">
        <div class="panel-heading"><h2><span class="small-icon">≡</span> {{ activeSimulator === 'camera' ? `Pelco-D history · ADDR ${address}` : 'Pelco-D command capture' }} <span class="count-badge">{{ captureEntries.length }}</span></h2><div class="capture-actions"><div class="filter-switch"><button :class="{ active: filter === 'all' }" @click="filter = 'all'">All commands</button><button :class="{ active: filter === 'issues' }" @click="filter = 'issues'">Issues only</button></div><button class="text-button" :disabled="!captureEntries.length" @click="exportLog">↓ Export</button><button class="text-button" :aria-label="activeSimulator === 'camera' ? 'Clear this camera history' : 'Clear Pelco-D history'" @click="clearLog">Clear</button></div></div>
        <div class="capture-table"><div class="capture-row table-head"><span>TIME</span><span>SOURCE</span><span>RAW BYTES</span><span>COMMAND</span><span>RESULT</span></div><button v-for="entry in visibleEntries" :key="entry.id" class="capture-row" :class="{ selected: selected?.id === entry.id }" @click="selected = entry"><span class="capture-time">{{ entry.time }}</span><span class="source-tag" :title="entry.source">{{ entry.source }}</span><code>{{ hexBytes(entry.bytes.slice(0, 30)) }}{{ entry.bytes.length > 30 ? ' …' : '' }}</code><span class="capture-description">{{ entry.description }}</span><span class="result-tag" :class="entryTone(entry)">{{ entry.result }}</span></button><div v-if="!visibleEntries.length" class="capture-empty"><span>⌁</span><strong>{{ captureEntries.length ? 'No issues in this capture' : activeSimulator === 'camera' ? `No commands for camera ${address}` : 'Your Pelco-D stream starts here' }}</strong><p>{{ captureEntries.length ? 'Change the filter to see all commands in this history.' : activeSimulator === 'camera' ? `Pelco-D commands addressed to ${address} appear here. NVR history is on the Overview page.` : 'Pelco-D commands on the shared camera and switcher bus appear here.' }}</p></div></div>
        <div class="capture-footer"><span><i class="status-dot" :class="{ offline: !serialConnected }"></i>{{ serialConnected ? 'Listening on serial' : 'Manual input ready' }}<span v-if="pending.length"> · {{ pending.length }} byte(s) awaiting frame completion</span></span><div><span>{{ captureStats.bytes }} bytes</span><span>{{ captureStats.frames }} frames</span><span :class="{ 'error-text': captureStats.rejected > 0 }">{{ captureStats.rejected }} rejected</span><span>{{ captureEntries.length }} retained{{ activeSimulator === 'camera' ? ` · ADDR ${address}` : ' · Pelco-D bus' }}</span></div></div>
      </section>

      <details class="panel settings-panel" :inert="isReplaying"><summary>Simulation settings <span>Protocol, speeds & presets</span></summary><div class="settings-content"><label>Protocol profile<select v-model.number="turboByte" @change="emergencyStop"><option :value="255">IRIS / legacy — FF turbo</option><option :value="64">Pelco v5.2.2 — 40 turbo</option></select></label><label>Control pan speed <span>{{ hex(panSpeed === 64 ? turboByte : panSpeed) }}</span><input v-model.number="panSpeed" type="range" min="0" max="64" /></label><label>Control tilt speed <span>{{ hex(tiltSpeed) }}</span><input v-model.number="tiltSpeed" type="range" min="0" max="63" /></label><label>Motion watchdog<select v-model.number="profile.watchdogMs"><option :value="15000">15 seconds</option><option :value="2000">2 seconds</option><option :value="0">Disabled — until stop command</option></select></label><div class="preset-settings"><label for="preset">Preset (1–32)</label><input id="preset" v-model.number="preset" type="number" min="1" max="32" @change="preset = Math.min(32, Math.max(1, Math.round(preset || 1)))" /><div><button class="button secondary" @click="localCommand(0, 3, 0, preset)">Save</button><button class="button secondary" @click="localCommand(0, 7, 0, preset)">Call</button><button class="text-button" @click="localCommand(0, 5, 0, preset)">Clear</button></div><small>{{ camera.presets.size }} saved · Held in memory for this camera address</small></div></div><p class="settings-footnote">Pelco-D: FF sync · 8-bit sum checksum · {{ hex(turboByte) }} turbo · speed 00 is slow motion. Supports standard motion, lens flags, auto focus, power, generic auto scan, absolute pan/tilt, display zero, presets 1–32, flip (33), and zero pan (34), plus IRIS thermal palette/mode presets and lamp control (90 → 3/4). Extended commands outside this set are flagged. This is a receive-only visual simulator; it does not implement protocol replies. <a href="https://www.ptzprotocols.com/1%20Pelco%20PTZ%20Protocols/D/DPprotoEPDF.pdf" target="_blank" rel="noopener noreferrer">Protocol reference ↗</a></p></details>
      </div>
      <footer class="page-footer"><span>IRIS SIMULATORS <i>·</i> SERIAL WORKBENCH</span><span>Local simulation. Real bytes.</span></footer>
    </main>
  </div>
</template>

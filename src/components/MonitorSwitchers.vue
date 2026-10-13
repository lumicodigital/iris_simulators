<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { baudRates, createSwitcher, maxPorts, normalizeSwitcher, type Switcher } from '../simulation/switcher'
import { hex } from '../protocol/pelcoD'

const props = defineProps<{ switchers: Switcher[]; storageError: string }>()
const emit = defineEmits<{ update: [devices: Switcher[]]; route: [device: Switcher, output: number, input: number] }>()
const selectedId = ref(props.switchers[0]?.id ?? '')
const selectedInput = ref(1)
const device = computed(() => props.switchers.find(item => item.id === selectedId.value))
const editor = ref<HTMLDialogElement>()
const draft = ref<Switcher>()
const editingId = ref('')
const inputCount = ref(4); const outputCount = ref(4)
const editorError = ref('')
const removed = ref<{ device: Switcher; index: number }>()
watch(() => props.switchers.map(item => item.id), ids => {
  if (!ids.includes(selectedId.value)) selectedId.value = ids[0] ?? ''
})
watch(() => device.value?.inputs.length, count => { if (selectedInput.value > (count ?? 0)) selectedInput.value = 1 })
watch(selectedId, () => { selectedInput.value = 1 })
const diagramHeight = computed(() => 100 + Math.max(device.value?.inputs.length ?? 1, device.value?.outputs.length ?? 1) * 58)
const activeCount = computed(() => Object.keys(device.value?.routes ?? {}).length)
const portY = (index: number) => 82 + index * 58
const outputRoute = (output: number) => device.value?.routes[output]
const activeInput = (input: number) => Object.values(device.value?.routes ?? {}).includes(input)
const routePath = (input: number, output: number) => `M 238 ${portY(input - 1)} C 315 ${portY(input - 1)}, 335 ${portY(output - 1)}, 388 ${portY(output - 1)} L 532 ${portY(output - 1)} C 596 ${portY(output - 1)}, 610 ${portY(output - 1)}, 680 ${portY(output - 1)}`
function route(output: number, input = selectedInput.value) {
  if (device.value?.enabled && input >= 1 && input <= device.value.inputs.length) emit('route', device.value, output, input)
}
async function routeFromSelect(output: number, event: Event) {
  const select = event.target as HTMLSelectElement
  route(output, Number(select.value))
  await nextTick()
  select.value = String(outputRoute(output) ?? '')
}
function openEditor(item?: Switcher) {
  const address = Array.from({ length: 55 }, (_, i) => 201 + i).find(value => !props.switchers.some(device => device.address === value)) ?? 201
  editingId.value = item?.id ?? ''
  draft.value = item ? { ...item, inputs: [...item.inputs], outputs: [...item.outputs], routes: { ...item.routes } } : createSwitcher(address)
  inputCount.value = draft.value.inputs.length; outputCount.value = draft.value.outputs.length
  editorError.value = ''; editor.value?.showModal()
}
function resizePorts(kind: 'inputs' | 'outputs') {
  if (!draft.value) return
  const count = Math.min(maxPorts, Math.max(1, Math.round(Number(kind === 'inputs' ? inputCount.value : outputCount.value) || 1)))
  if (kind === 'inputs') inputCount.value = count; else outputCount.value = count
  const previous = draft.value[kind]
  draft.value[kind] = Array.from({ length: count }, (_, i) => previous[i] ?? `${kind === 'inputs' ? 'Input' : 'Monitor'} ${i + 1}`)
}
function save() {
  if (!draft.value) return
  resizePorts('inputs'); resizePorts('outputs')
  const saved = normalizeSwitcher(draft.value)
  if (!saved) { editorError.value = 'Use address 201–255 and at least one input and output.'; return }
  if (!editingId.value && props.switchers.length >= 32) { editorError.value = 'The simulator supports up to 32 switchers.'; return }
  if (editingId.value && props.switchers.find(item => item.id === editingId.value)?.address !== saved.address) { saved.routes = {}; saved.updatedAt = 0 }
  const devices = editingId.value ? props.switchers.map(item => item.id === editingId.value ? saved : item) : [...props.switchers, saved]
  emit('update', devices); selectedId.value = saved.id; editor.value?.close()
}
function remove() {
  const index = props.switchers.findIndex(item => item.id === editingId.value)
  if (index < 0) return
  removed.value = { device: props.switchers[index], index }
  emit('update', props.switchers.filter(item => item.id !== editingId.value)); editor.value?.close()
}
function undoRemove() {
  if (!removed.value || props.switchers.length >= 32) return
  const devices = [...props.switchers]; devices.splice(removed.value.index, 0, removed.value.device)
  emit('update', devices); selectedId.value = removed.value.device.id; removed.value = undefined
}
</script>

<template>
  <section class="panel switcher-panel">
    <div class="panel-heading"><h2><span class="small-icon">⇄</span> Monitor switching</h2><button class="button secondary" :disabled="switchers.length >= 32" @click="openEditor()">+ Add switcher</button></div>
    <div v-if="removed" class="undo-notice" role="status">Removed {{ removed.device.name }}.<button class="text-button" @click="undoRemove">Undo</button><button class="text-button" aria-label="Dismiss undo" @click="removed = undefined">×</button></div>
    <div v-if="storageError" class="inline-warning" role="alert">{{ storageError }}</div>
    <template v-if="device">
      <div class="switcher-toolbar">
        <label for="selected-switcher">SWITCHER<select id="selected-switcher" v-model="selectedId"><option v-for="item in switchers" :key="item.id" :value="item.id">{{ item.name }} · {{ item.address }}{{ item.enabled ? '' : ' · disabled' }}</option></select></label>
        <div class="device-meta"><span class="rx-badge">0x{{ hex(device.address) }}</span><span>{{ device.baudRate }} baud</span></div>
        <button class="button secondary" @click="openEditor(device)">Configure</button>
      </div>
      <div class="routing-summary"><div><i class="status-dot" :class="{ offline: !device.enabled }"></i><strong>{{ device.enabled ? 'Listening on shared bus' : 'Device disabled' }}</strong><span>{{ device.inputs.length }} inputs · {{ device.outputs.length }} outputs</span></div><span><b>{{ activeCount }}</b> / {{ device.outputs.length }} routed</span></div>
      <div class="route-instruction">Select an input, then an output to send a routing command.<span>Active paths are highlighted in mint.</span></div>
      <div class="routing-diagram" :class="{ 'device-disabled': !device.enabled }">
        <svg :viewBox="`0 0 920 ${diagramHeight}`" role="group" :aria-label="`${device.name} input to output routing diagram`">
          <defs><marker :id="`arrow-${device.id}`" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#75e6c5" /></marker></defs>
          <text x="28" y="28" class="diagram-label">INPUTS</text><text x="388" y="28" class="diagram-label">SERIAL SWITCHER</text><text x="696" y="28" class="diagram-label">OUTPUTS / MONITORS</text>
          <rect x="388" y="49" width="144" :height="diagramHeight - 73" rx="12" class="switch-core" />
          <path v-for="(_, i) in device.inputs" :key="`input-wire-${i}`" :d="`M 238 ${portY(i)} L 388 ${portY(i)}`" class="inactive-wire" />
          <path v-for="(_, i) in device.outputs" :key="`output-wire-${i}`" :d="`M 532 ${portY(i)} L 680 ${portY(i)}`" class="inactive-wire" />
          <template v-for="(_, i) in device.outputs" :key="`route-${i}`"><path v-if="outputRoute(i + 1)" :d="routePath(outputRoute(i + 1)!, i + 1)" class="active-route route-glow" /><path v-if="outputRoute(i + 1)" :d="routePath(outputRoute(i + 1)!, i + 1)" class="active-route" :data-active-route="`${outputRoute(i + 1)}-${i + 1}`" :marker-end="`url(#arrow-${device.id})`"><title>{{ device.inputs[outputRoute(i + 1)! - 1] }} → {{ device.outputs[i] }}</title></path></template>
          <text x="460" :y="diagramHeight - 39" text-anchor="middle" class="core-caption">ADDR {{ device.address }} · 0D</text>
          <g v-for="(name, i) in device.inputs" :key="`input-${i}`" class="port-node input-node" :class="{ 'port-active': activeInput(i + 1), 'port-selected': selectedInput === i + 1 }" role="button" tabindex="0" :aria-label="`Select input ${i + 1}: ${name}`" :aria-pressed="selectedInput === i + 1" @click="selectedInput = i + 1" @keydown.enter.prevent="selectedInput = i + 1" @keydown.space.prevent="selectedInput = i + 1">
            <title>{{ i + 1 }} · {{ name }}</title><rect x="28" :y="portY(i) - 21" width="210" height="42" rx="7" /><circle cx="45" :cy="portY(i)" r="3" /><text x="60" :y="portY(i) + 4" class="port-number">{{ String(i + 1).padStart(2, '0') }}</text><text x="90" :y="portY(i) + 4" class="port-name">{{ name.length > 18 ? name.slice(0, 17) + '…' : name }}</text>
          </g>
          <g v-for="(name, i) in device.outputs" :key="`output-${i}`" class="port-node output-node" :class="{ 'port-active': outputRoute(i + 1) }" role="button" :tabindex="device.enabled ? 0 : -1" :aria-disabled="!device.enabled" :aria-label="`Route selected input to output ${i + 1}: ${name}`" @click="route(i + 1)" @keydown.enter.prevent="route(i + 1)" @keydown.space.prevent="route(i + 1)">
            <title>{{ name }} · {{ outputRoute(i + 1) ? `Input ${outputRoute(i + 1)}: ${device.inputs[outputRoute(i + 1)! - 1]}` : 'No route received' }}</title><rect x="696" :y="portY(i) - 21" width="196" height="42" rx="7" /><text x="711" :y="portY(i) + 4" class="port-number">{{ String(i + 1).padStart(2, '0') }}</text><text x="741" :y="portY(i) + 4" class="port-name">{{ name.length > 17 ? name.slice(0, 16) + '…' : name }}</text><circle cx="884" :cy="portY(i)" r="3" />
          </g>
        </svg>
      </div>
      <div class="route-assignments"><div class="route-list-heading"><span>OUTPUT ASSIGNMENTS</span><span>{{ device.updatedAt ? `Last route ${new Date(device.updatedAt).toLocaleTimeString('en-GB')}` : 'Waiting for first route' }}</span></div>
        <label v-for="(name, i) in device.outputs" :key="i" class="route-assignment"><span><code>{{ String(i + 1).padStart(2, '0') }}</code> {{ name }}</span><select :value="outputRoute(i + 1) ?? ''" :disabled="!device.enabled" :aria-label="`Input for output ${i + 1}: ${name}`" @change="routeFromSelect(i + 1, $event)"><option value="" disabled>No route received</option><option v-for="(inputName, j) in device.inputs" :key="j" :value="j + 1">{{ j + 1 }} · {{ inputName }}</option></select></label>
      </div>
      <p class="switcher-footnote">Routes update only when a valid command reaches this device. Configure its address and ports to match IRIS. Switcher configuration and routes are saved in this browser.</p>
    </template>
    <div v-else class="switcher-empty"><span>⇄</span><h3>Add your first monitor switcher</h3><p>Name its inputs and outputs, then watch routing commands connect them.</p><button class="button primary" @click="openEditor()">+ Add switcher</button></div>
    <dialog ref="editor" class="switcher-editor" aria-labelledby="switcher-editor-title">
      <form v-if="draft" @submit.prevent="save">
        <div class="editor-heading"><div class="eyebrow">SIMULATED DEVICE</div><h3 id="switcher-editor-title">{{ editingId ? 'Configure switcher' : 'Add monitor switcher' }}</h3><button type="button" class="icon-button" aria-label="Close switcher editor" @click="editor?.close()">×</button></div>
        <div class="editor-fields"><label class="wide-field">Switcher name<input v-model="draft.name" required maxlength="80" placeholder="Bridge monitor switcher" /></label><label>Serial address<input v-model.number="draft.address" type="number" required min="201" max="255" step="1" /><small>IRIS switchers: 201–255</small></label><label>Device baud rate<select v-model.number="draft.baudRate"><option v-for="rate in baudRates" :key="rate" :value="rate">{{ rate }}</option></select></label><label>Inputs<input v-model.number="inputCount" type="number" required min="1" :max="maxPorts" @change="resizePorts('inputs')" /></label><label>Outputs<input v-model.number="outputCount" type="number" required min="1" :max="maxPorts" @change="resizePorts('outputs')" /></label><label class="enabled-field wide-field"><input v-model="draft.enabled" type="checkbox" /> Listen on shared serial bus</label></div>
        <div class="port-edit-columns"><div><h4>INPUT NAMES</h4><label v-for="(_, i) in draft.inputs" :key="i"><code>{{ i + 1 }}</code><input v-model="draft.inputs[i]" :aria-label="`Input ${i + 1} name`" maxlength="80" :placeholder="`Input ${i + 1}`" /></label></div><div><h4>OUTPUT NAMES</h4><label v-for="(_, i) in draft.outputs" :key="i"><code>{{ i + 1 }}</code><input v-model="draft.outputs[i]" :aria-label="`Output ${i + 1} name`" maxlength="80" :placeholder="`Monitor ${i + 1}`" /></label></div></div>
        <p class="editor-note">Duplicate addresses are allowed to test interference. Changing an address clears that device's routes; reducing ports removes routes that no longer fit.</p><p v-if="editorError" class="error-message" role="alert">{{ editorError }}</p>
        <div class="editor-actions"><button v-if="editingId" type="button" class="text-button remove-device" @click="remove">Remove switcher</button><button type="button" class="button secondary" @click="editor?.close()">Cancel</button><button class="button primary" type="submit">Save switcher</button></div>
      </form>
    </dialog>
  </section>
</template>

<style scoped>
.switcher-toolbar{display:flex;align-items:flex-end;gap:15px;padding:20px;border-bottom:1px solid var(--line)}.switcher-toolbar>label{display:flex;flex-direction:column;gap:8px;font-size:8px;letter-spacing:1px;flex:1;min-width:0;color:#829cab}.switcher-toolbar select{width:100%;font-size:12px;letter-spacing:0}.switcher-toolbar>.button{height:38px}.device-meta{display:flex;flex-direction:column;gap:8px;padding-bottom:3px;font-family:var(--mono);font-size:8px;color:#819bab}.device-meta .rx-badge{width:fit-content}.routing-summary{display:flex;justify-content:space-between;gap:15px;padding:17px 20px;font-size:10px;color:#829aa9}.routing-summary>div{display:flex;align-items:center;gap:9px;flex-wrap:wrap}.routing-summary strong{font-weight:500;color:#c0d5de}.routing-summary b{color:var(--mint);font-family:var(--mono);font-weight:500}.route-instruction{padding:0 20px 14px;font-size:10px;color:#9eafbc;line-height:1.7}.route-instruction>span{color:#637e8e;margin-left:8px}.routing-diagram{background:radial-gradient(ellipse at center,#182c33,#101a22);border-top:1px solid #2a3e47;border-bottom:1px solid var(--line);max-height:470px;overflow:auto;padding:10px 0}.routing-diagram svg{display:block;width:100%;height:auto;min-width:550px}.diagram-label{fill:#779aaa;font-family:var(--mono);font-size:13px;letter-spacing:1.3px}.switch-core{fill:#192933;stroke:#3a5361;stroke-width:1;stroke-dasharray:4 4}.inactive-wire{fill:none;stroke:#304650;stroke-width:1.5}.active-route{fill:none;stroke:var(--mint);stroke-width:2;opacity:.9}.route-glow{stroke-width:7;opacity:.07}.core-caption{fill:#749ba8;font-family:var(--mono);font-size:12px;letter-spacing:.9px}.port-node{cursor:pointer;outline:none}.port-node rect{fill:#1a2933;stroke:#344d5b;stroke-width:1.2}.port-node circle{fill:#577080}.port-number{fill:#668b9e;font-family:var(--mono);font-size:14px}.port-name{fill:#b4cbd7;font-size:16px}.port-active rect{fill:#1c3833;stroke:#477c6c}.port-active circle{fill:var(--mint)}.port-selected rect,.port-node:hover rect,.port-node:focus-visible rect{stroke:var(--mint);stroke-width:2}.port-selected .port-name{fill:#d2f6e9}.device-disabled{opacity:.5}.route-assignments{padding:17px 20px;max-height:260px;overflow:auto}.route-list-heading{display:flex;justify-content:space-between;gap:15px;font-family:var(--mono);font-size:8px;letter-spacing:.7px;color:#7293a3;padding-bottom:12px}.route-assignment{display:flex;align-items:center;justify-content:space-between;gap:15px;padding:6px 0;font-size:10px;color:#b3c5d1}.route-assignment>span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.route-assignment code{color:#607f93;padding-right:8px}.route-assignment select{width:48%;font-size:10px;padding:8px}.switcher-footnote{padding:13px 20px;margin:0;border-top:1px solid var(--line);color:#6f8d9f;font-size:9px;line-height:1.8}.switcher-empty{padding:80px 24px;text-align:center;color:#839eaf}.switcher-empty>span{font-size:45px;color:var(--mint)}.switcher-empty h3{font-size:17px;color:#d1e1e9;font-weight:500}.switcher-empty p{font-size:11px;line-height:1.8;margin-bottom:25px}.undo-notice{padding:12px 20px;font-size:11px;background:#24372f;color:#b6dace;display:flex;align-items:center;gap:15px}.undo-notice button:last-child{margin-left:auto}.switcher-editor{background:#18212a;border:1px solid #47606d;border-radius:10px;color:#dce3e8;max-width:650px;width:calc(100% - 32px);max-height:90dvh;padding:24px;box-shadow:0 25px 80px #0008}.switcher-editor::backdrop{background:#050d13b8;backdrop-filter:blur(3px)}.editor-heading{position:relative;padding-right:40px}.editor-heading .eyebrow{margin-bottom:8px}.editor-heading h3{font-size:20px;font-weight:500;margin:0 0 23px}.editor-heading>.icon-button{position:absolute;top:0;right:0}.editor-fields{display:grid;grid-template-columns:1fr 1fr;gap:17px}.editor-fields label{font-size:11px;color:#a9bfcd;display:flex;flex-direction:column;gap:8px}.editor-fields input:not([type=checkbox]),.editor-fields select{width:100%;padding:10px;font-size:12px}.wide-field{grid-column:1/-1}.editor-fields small{color:#6f8c9d;font-size:9px}.editor-fields .enabled-field{flex-direction:row;align-items:center}.port-edit-columns{display:grid;grid-template-columns:1fr 1fr;gap:22px;margin-top:20px}.port-edit-columns h4{font-size:9px;font-weight:500;letter-spacing:1px;color:#7997a8}.port-edit-columns label{display:flex;gap:8px;align-items:center;margin-bottom:8px}.port-edit-columns code{color:#5f8197;font-size:10px;min-width:18px}.port-edit-columns input{width:100%;padding:9px;font-size:11px;min-width:0}.editor-note{font-size:10px;line-height:1.8;color:#7c9bac;margin:18px 0}.editor-actions{border-top:1px solid var(--line);padding-top:18px;display:flex;justify-content:flex-end;align-items:center;gap:12px}.remove-device{margin-right:auto;color:var(--red)}
@media(max-width:1000px){.device-meta{display:none}.switcher-toolbar{gap:10px}.routing-summary>div>span{width:100%;padding-left:15px}.route-list-heading{font-size:7px}}@media(max-width:760px){.port-edit-columns{gap:12px}.switcher-toolbar{padding:17px}.route-instruction>span{display:block;margin-left:0}.route-list-heading{font-size:8px}.switcher-editor{padding:20px}.editor-actions{gap:8px}.editor-actions .button{font-size:11px;padding:10px}}
</style>

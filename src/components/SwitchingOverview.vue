<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { hex } from '../protocol/pelcoD'
import type { Switcher } from '../simulation/switcher'

const props = defineProps<{ switchers: Switcher[] }>()
const emit = defineEmits<{ configure: [] }>()
const viewport = ref<HTMLDivElement>()
const selectedId = ref(props.switchers[0]?.id ?? '')
const currentIndex = computed(() => Math.max(0, props.switchers.findIndex(item => item.id === selectedId.value)))
const device = computed(() => props.switchers[currentIndex.value])
const mapHeight = computed(() => 120 + Math.max(device.value?.inputs.length ?? 0, device.value?.outputs.length ?? 0) * 46)
const activeRoutes = computed(() => Object.keys(device.value?.routes ?? {}).length)
const portY = (index: number) => 93 + index * 46
const shortName = (name: string) => name.length > 20 ? name.slice(0, 19) + '…' : name
const activeInput = (device: Switcher, input: number) => Object.values(device.routes).includes(input)
const path = (input: number, output: number) => `M 235 ${portY(input - 1)} C 283 ${portY(input - 1)}, 296 ${portY(output - 1)}, 338 ${portY(output - 1)} L 462 ${portY(output - 1)} L 553 ${portY(output - 1)}`
function changePage(delta: number) {
  const index = Math.min(props.switchers.length - 1, Math.max(0, currentIndex.value + delta))
  selectedId.value = props.switchers[index]?.id ?? ''
}
watch(() => props.switchers.map(item => item.id), (ids, previous) => {
  if (!ids.includes(selectedId.value)) {
    const index = Math.min(Math.max(0, previous.indexOf(selectedId.value)), ids.length - 1)
    selectedId.value = ids[index] ?? ''
  }
})
watch(selectedId, () => viewport.value?.scrollTo({ top: 0, left: 0 }))
</script>


<template>
  <section class="panel overview-map-panel">
    <div class="panel-heading"><h2><span class="small-icon">⇄</span> Switching maps <span class="count-badge">{{ switchers.length }}</span></h2><nav class="map-pagination" aria-label="Switching map pages"><button class="icon-button" aria-label="Previous switching map" :disabled="currentIndex === 0 || !device" @click="changePage(-1)">‹</button><output aria-label="Switching map page" aria-live="polite">{{ device ? currentIndex + 1 : 0 }} / {{ switchers.length }}</output><button class="icon-button" aria-label="Next switching map" :disabled="currentIndex >= switchers.length - 1 || !device" @click="changePage(1)">›</button></nav></div>
    <div ref="viewport" class="all-maps-viewport">
      <div v-if="device" class="single-map-canvas">
      <svg :viewBox="`0 0 840 ${mapHeight + 40}`" preserveAspectRatio="xMidYMid meet" role="img" :aria-label="`${device.name} switching map, with active input to output routes highlighted`">
        <defs><pattern id="overview-map-grid" width="22" height="22" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="0.7" fill="#304550" /></pattern><marker id="overview-route-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="#75e6c5" /></marker></defs>
        <rect width="100%" height="100%" fill="url(#overview-map-grid)" />
        <g transform="translate(20 20)" :opacity="device.enabled ? 1 : 0.45" :data-switcher-map="device.id">
            <rect width="800" :height="mapHeight" rx="12" class="map-frame" />
            <text x="20" y="30" class="map-title">{{ device.name.length > 52 ? device.name.slice(0, 51) + '…' : device.name }}<title>{{ device.name }}</title></text><text x="780" y="30" text-anchor="end" class="map-address">{{ device.address }} / 0x{{ hex(device.address) }}{{ device.enabled ? '' : ' · DISABLED' }}</text>
            <text x="20" y="61" class="map-label">INPUTS</text><text x="338" y="61" class="map-label">SWITCHER</text><text x="565" y="61" class="map-label">OUTPUTS</text>
            <rect x="338" y="74" width="124" :height="mapHeight - 96" rx="9" class="map-core" />
            <path v-for="(_, i) in device.inputs" :key="`in-wire-${i}`" :d="`M 235 ${portY(i)} L 338 ${portY(i)}`" class="map-wire" />
            <path v-for="(_, i) in device.outputs" :key="`out-wire-${i}`" :d="`M 462 ${portY(i)} L 553 ${portY(i)}`" class="map-wire" />
            <template v-for="(_, i) in device.outputs" :key="`active-${i}`"><path v-if="device.routes[i + 1]" :d="path(device.routes[i + 1], i + 1)" class="map-active-wire" marker-end="url(#overview-route-arrow)" :data-overview-route="`${device.id}:${device.routes[i + 1]}-${i + 1}`"><title>{{ device.name }}: {{ device.inputs[device.routes[i + 1] - 1] }} → {{ device.outputs[i] }}</title></path></template>
            <g v-for="(name, i) in device.inputs" :key="`in-${i}`" :class="{ 'map-active-node': activeInput(device, i + 1) }"><title>Input {{ i + 1 }}: {{ name }}</title><rect x="20" :y="portY(i) - 16" width="215" height="32" rx="5" class="map-node" /><text x="30" :y="portY(i) + 5" class="map-port-number">{{ String(i + 1).padStart(2, '0') }}</text><text x="61" :y="portY(i) + 5" class="map-port-name">{{ shortName(name) }}</text></g>
            <g v-for="(name, i) in device.outputs" :key="`out-${i}`" :class="{ 'map-active-node': device.routes[i + 1] }"><title>Output {{ i + 1 }}: {{ name }} · {{ device.routes[i + 1] ? device.inputs[device.routes[i + 1] - 1] : 'No route received' }}</title><rect x="565" :y="portY(i) - 16" width="215" height="32" rx="5" class="map-node" /><text x="575" :y="portY(i) + 5" class="map-port-number">{{ String(i + 1).padStart(2, '0') }}</text><text x="606" :y="portY(i) + 5" class="map-port-name">{{ shortName(name) }}</text></g>
        </g>
      </svg>
      </div>
      <div v-else class="maps-empty"><span>⇄</span><strong>No switchers configured</strong><button class="button secondary" @click="emit('configure')">Configure switchers</button></div>
    </div>
    <div class="overview-map-footer"><span>{{ device ? `${activeRoutes} active routes` : 'No switchers configured' }}</span><span><button class="text-button" @click="emit('configure')">Configure switchers ↗</button></span></div>
  </section>
</template>

<style scoped>
.overview-map-panel{min-width:0;min-height:380px;display:flex;flex-direction:column}.map-pagination{display:flex;align-items:center;gap:9px}.map-pagination .icon-button{font-size:21px;width:27px;height:27px;line-height:1}.map-pagination output{font-family:var(--mono);font-size:10px;color:#93b1c1;text-align:center;min-width:52px}.all-maps-viewport{position:relative;min-height:0;flex:1;background:#101b24;overflow:hidden}.single-map-canvas{position:absolute;inset:0}.single-map-canvas>svg{display:block;width:100%;height:100%}.map-frame{fill:#17252e;stroke:#3a515f;stroke-width:1.4}.map-title{fill:#c7dce6;font-size:17px;font-weight:500}.map-address{fill:#829fb0;font-family:var(--mono);font-size:12px}.map-label{fill:#6e95a8;font-family:var(--mono);font-size:11px;letter-spacing:1.5px}.map-core{fill:#1b2c34;stroke:#3a5764;stroke-dasharray:4 4}.map-wire{stroke:#304751;stroke-width:1.3;fill:none}.map-active-wire{stroke:var(--mint);stroke-width:2;fill:none}.map-node{fill:#1d2d38;stroke:#3b5361}.map-active-node .map-node{fill:#213b35;stroke:#487f6f}.map-port-number{fill:#7396aa;font-family:var(--mono);font-size:12px}.map-port-name{fill:#b8d1de;font-size:14px}.overview-map-footer{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px;border-top:1px solid var(--line);font-size:8px;color:#6d8d9e}.overview-map-footer button{font-size:8px}.maps-empty{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:18px;color:#7594a6;font-size:12px}.maps-empty>span{font-size:35px;color:var(--mint)}
@media(max-width:760px){.overview-map-panel .panel-heading{padding:0 13px;gap:7px}.overview-map-panel h2{font-size:10px;gap:5px}.map-pagination{gap:7px}.map-pagination output{min-width:43px;font-size:9px}.overview-map-footer{flex-wrap:wrap;font-size:8px}}
</style>

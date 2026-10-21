<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import PacketInspector from './PacketInspector.vue'
import { hexBytes } from '../protocol/pelcoD'
import { captureSummary, type CaptureEntry } from '../simulation/history'

const props = defineProps<{ entries: CaptureEntry[]; selectedId?: number }>()
const emit = defineEmits<{ clear: [] }>()
const selected = ref<CaptureEntry>()
const issuesOnly = ref(false)
const visible = computed(() => props.entries.filter(entry => !issuesOnly.value || entry.issues.some(issue => issue.severity !== 'info')))
const summary = computed(() => captureSummary(props.entries))
watch(() => props.entries[0]?.id, () => { selected.value = props.entries[0] }, { immediate: true })
watch(() => props.selectedId, id => { if (id !== undefined) selected.value = props.entries.find(entry => entry.id === id) ?? props.entries[0] }, { immediate: true })
function tone(entry: CaptureEntry) { return entry.issues.some(issue => issue.severity === 'error') ? 'error' : entry.issues.some(issue => issue.severity === 'warning') ? 'warning' : entry.result === 'Ignored' ? 'neutral' : 'success' }
function exportLog() {
  const url = URL.createObjectURL(new Blob([JSON.stringify(props.entries.slice().reverse(), null, 2)], { type: 'application/json' }))
  const link = document.createElement('a'); link.href = url; link.download = 'iris-nvr-capture.json'; link.click(); URL.revokeObjectURL(url)
}
</script>

<template>
  <section id="overview-nvr-history" class="overview-nvr-history" aria-label="NVR command history">
    <section class="panel capture-panel">
      <div class="panel-heading"><h2><span class="small-icon">≡</span> NVR command history <span class="count-badge">{{ entries.length }}</span></h2><div class="capture-actions"><div class="filter-switch"><button :class="{ active: !issuesOnly }" @click="issuesOnly = false">All NVR commands</button><button :class="{ active: issuesOnly }" @click="issuesOnly = true">Issues only</button></div><button class="text-button" :disabled="!entries.length" @click="exportLog">↓ Export</button><button class="text-button" aria-label="Clear NVR history" @click="emit('clear')">Clear</button></div></div>
      <div class="capture-table"><div class="capture-row table-head"><span>TIME</span><span>SOURCE</span><span>RAW BYTES</span><span>COMMAND</span><span>RESULT</span></div><button v-for="entry in visible" :key="entry.id" class="capture-row" :class="{ selected: selected?.id === entry.id }" @click="selected = entry"><span class="capture-time">{{ entry.time }}</span><span class="source-tag" :title="entry.source">{{ entry.source }}</span><code>{{ hexBytes(entry.bytes.slice(0, 30)) }}{{ entry.bytes.length > 30 ? ' …' : '' }}</code><span class="capture-description">{{ entry.description }}</span><span class="result-tag" :class="tone(entry)">{{ entry.result }}</span></button><div v-if="!visible.length" class="capture-empty"><span>⌁</span><strong>{{ entries.length ? 'No NVR issues in this capture' : 'Waiting for NVR commands' }}</strong><p>{{ entries.length ? 'Select All NVR commands to view the history.' : 'Commands from the separate NVR serial line appear here, including press, release and rejected frames.' }}</p></div></div>
      <div class="capture-footer"><span>Separate NVR serial line</span><div><span>{{ summary.bytes }} bytes</span><span>{{ summary.frames }} frames</span><span :class="{ 'error-text': summary.rejected > 0 }">{{ summary.rejected }} rejected</span></div></div>
    </section>
    <PacketInspector :entry="selected" protocol="nvr" />
  </section>
</template>

<style scoped>
.overview-nvr-history{margin-top:20px;scroll-margin-top:20px}.overview-nvr-history .capture-panel{margin-top:0}.overview-nvr-history .capture-table{max-height:320px;overflow:auto}
</style>

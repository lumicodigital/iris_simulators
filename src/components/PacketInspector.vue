<script setup lang="ts">
import { computed } from 'vue'
import { fields, hex } from '../protocol/pelcoD'
import { nvrFields } from '../protocol/nvr'
import type { CaptureEntry } from '../simulation/history'

const props = defineProps<{ entry?: CaptureEntry; protocol?: 'pelco' | 'nvr'; heading?: string }>()
const nvr = computed(() => props.protocol === 'nvr' || props.entry?.protocol === 'nvr')
const inspectorFields = computed(() => nvr.value ? nvrFields : fields)
const fieldNotes = computed(() => nvr.value ? ['Always AA', 'Key matrix row', 'Key matrix column', '01 press / 00 release'] : ['Always FF', 'Device address', 'Power / lens flags', 'Motion / opcode', props.entry?.packet?.command?.type === 'route' ? 'Switch output number' : 'Pan speed / data', props.entry?.packet?.command?.type === 'route' ? 'Switch input number' : 'Tilt speed / data', 'Sum bytes 2–6'])
const tone = computed(() => props.entry?.issues.some(issue => issue.severity === 'error') ? 'error' : props.entry?.issues.some(issue => issue.severity === 'warning') ? 'warning' : ['Ignored', 'No device', 'No preset'].includes(props.entry?.result ?? '') ? 'neutral' : 'success')
</script>

<template>
  <section class="panel inspector-panel" :aria-label="heading || (nvr ? 'NVR packet inspector' : 'Pelco-D packet inspector')">
    <div class="panel-heading"><h2><span class="small-icon">▤</span> {{ heading || (nvr ? 'NVR packet inspector · separate serial line' : 'Packet inspector') }}</h2><div v-if="entry" class="packet-verdict" :class="tone"><i class="status-dot"></i>{{ entry.result }}</div><span v-else class="muted small">Waiting for a command</span></div>
    <div class="inspector-body">
      <div class="byte-grid" :class="{ 'nvr-bytes': nvr }"><div v-for="(field, index) in inspectorFields" :key="field" class="byte-cell" :class="{ 'byte-error': entry?.issues.some(issue => issue.severity === 'error' && issue.bytes.includes(index)), 'byte-warning': entry?.issues.some(issue => issue.severity === 'warning' && issue.bytes.includes(index)) }"><span class="byte-index">{{ String(index + 1).padStart(2, '0') }} <span>{{ field }}</span></span><strong>{{ entry?.bytes[index] === undefined ? '—' : hex(entry.bytes[index]) }}</strong><span class="binary">{{ entry?.bytes[index]?.toString(2).padStart(8, '0') ?? '········' }}</span><span class="byte-note">{{ fieldNotes[index] }}</span></div></div>
      <div class="decoded-line"><span>DECODED</span><strong>{{ entry?.description ?? (nvr ? 'NVR serial commands appear here as they arrive.' : 'Send a Pelco-D command to inspect its bytes and device response.') }}</strong><span v-if="entry?.packet" class="expected-checksum">Expected checksum <code>{{ hex(entry.packet.checksum) }}</code></span></div>
      <div v-if="entry?.issues.length" class="issues-list"><div v-for="(issue, index) in entry.issues" :key="index" class="issue" :class="issue.severity"><span>{{ issue.severity === 'error' ? '×' : issue.severity === 'warning' ? '!' : 'i' }}</span><p>{{ issue.message }}</p></div></div>
      <div v-else-if="entry" class="valid-note"><span>✓</span> All bytes valid. {{ entry.bytes.length }}-byte frame verified.</div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'
import { baudRates } from '../simulation/switcher'
import type { SerialPortInfo } from '../simulation/serialPorts'

const props = defineProps<{ line: 'camera' | 'nvr'; ports: SerialPortInfo[]; path: string; baudRate: number; connected: boolean; connectedPath: string; busy: boolean; bridgeConnected: boolean; error: string; refreshing: boolean; portsError: string }>()
const emit = defineEmits<{ 'update:path': [path: string]; 'update:baudRate': [rate: number]; toggle: [path: string, baudRate: number]; refresh: [] }>()
const id = useId()
const label = computed(() => props.line === 'camera' ? 'Camera' : 'NVR')
const custom = ref(false)
const path = computed(() => props.connected ? props.connectedPath : props.path)
const available = computed(() => [...props.ports].sort((a, b) => Number(Boolean(b.manufacturer)) - Number(Boolean(a.manufacturer)) || a.path.localeCompare(b.path)))
const selected = computed({
  get: () => custom.value || (path.value && !props.ports.some(port => port.path === path.value)) ? '__custom__' : path.value,
  set: value => {
    custom.value = value === '__custom__'
    if (!custom.value) emit('update:path', value)
  },
})
watch(path, value => { if (props.connected || props.ports.some(port => port.path === value)) custom.value = false })
</script>

<template>
  <div class="serial-connection">
    <div class="port-label"><label :for="`${id}-port`">{{ label }} serial device</label><button type="button" class="text-button" :disabled="refreshing" @click="emit('refresh')">{{ refreshing ? 'Refreshing…' : '↻ Refresh' }}</button></div>
    <select :id="`${id}-port`" v-model="selected" :aria-label="`${label} serial device`" :disabled="connected || busy">
      <option value="" disabled>{{ available.length ? 'Choose a serial device' : 'No serial devices detected' }}</option>
      <option v-for="port in available" :key="port.path" :value="port.path">{{ port.path }}{{ port.manufacturer ? ` · ${port.manufacturer}` : '' }}</option>
      <option value="__custom__">Enter a device path…</option>
    </select>
    <input v-if="selected === '__custom__'" :id="`${id}-custom-port`" :value="path" :aria-label="`${label} serial device path`" placeholder="/dev/cu.usbserial… or /dev/ttys…" :disabled="connected || busy" @input="emit('update:path', ($event.target as HTMLInputElement).value)" />
    <div class="serial-format"><label :for="`${id}-baud`">{{ label }} line baud rate<select :id="`${id}-baud`" :value="baudRate" :aria-label="`${label} line baud rate`" :disabled="connected || busy" @change="emit('update:baudRate', Number(($event.target as HTMLSelectElement).value))"><option v-for="rate in baudRates" :key="rate" :value="rate">{{ rate }}</option></select></label><span>8N1<small>8 data · no parity · 1 stop</small></span></div>
    <button type="button" class="button" :class="connected ? 'secondary' : 'primary'" :disabled="busy || !bridgeConnected || (!connected && !path)" :aria-label="`${connected ? 'Disconnect' : 'Connect'} ${label.toLowerCase()} serial`" @click="emit('toggle', path, baudRate)">{{ busy ? 'Please wait…' : connected ? `Disconnect ${label} serial` : `Connect ${label} serial` }} <span>⌁</span></button>
    <p v-if="connected" class="serial-connected"><i class="status-dot"></i> Receiving from {{ connectedPath }}</p>
    <p v-if="!bridgeConnected" class="serial-note">Serial bridge offline. Start the simulator to connect a device.</p>
    <p v-if="error || portsError" class="error-message" role="alert">{{ error || portsError }}</p>
  </div>
</template>

<style scoped>
.serial-connection{display:flex;flex-direction:column;gap:10px;min-width:0}.port-label{display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:10px;color:#9eb5c3}.port-label button{font-size:9px}.serial-connection>select,.serial-connection>input{width:100%;font-size:11px;padding:10px;min-width:0}.serial-connection>select{font-family:var(--mono);cursor:pointer}.serial-connection>input{font-family:var(--mono)}.serial-format{display:grid;grid-template-columns:1fr 1fr;align-items:end;gap:18px;margin:2px 0 4px}.serial-format label{font-size:9px;color:#8ba4b5}.serial-format select{display:block;width:100%;margin-top:6px;padding:8px;font-size:11px}.serial-format>span{font-family:var(--mono);font-size:12px;color:#adc8d8;padding-bottom:3px}.serial-format small{display:block;font-size:8px;color:#708da0;margin-top:7px}.serial-connection>.button{width:100%;justify-content:space-between;font-size:11px;min-height:35px}.serial-connected{font-size:10px;color:var(--mint);line-height:1.6;overflow-wrap:anywhere;margin:0}.serial-connected i{margin-right:5px}.serial-connection .serial-note{margin:0;padding:0;border:0;font-size:10px}.serial-connection .error-message{margin:0;overflow-wrap:anywhere}
</style>

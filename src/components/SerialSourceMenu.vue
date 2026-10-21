<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, useId } from 'vue'
import SerialConnection from './SerialConnection.vue'
import type { SerialPortInfo } from '../simulation/serialPorts'

const props = defineProps<{ ports: SerialPortInfo[]; refreshing: boolean; portsError: string; bridgeConnected: boolean; cameraPath: string; cameraBaud: number; cameraConnected: boolean; cameraConnectedPath: string; cameraBusy: boolean; cameraError: string; nvrPath: string; nvrBaud: number; nvrConnected: boolean; nvrConnectedPath: string; nvrBusy: boolean; nvrError: string }>()
const emit = defineEmits<{ 'update:cameraPath': [value: string]; 'update:cameraBaud': [value: number]; 'update:nvrPath': [value: string]; 'update:nvrBaud': [value: number]; camera: [path: string, baudRate: number]; nvr: [path: string, baudRate: number]; refresh: [] }>()
const open = ref(false)
const host = ref<HTMLElement>(); const panel = ref<HTMLElement>(); const trigger = ref<HTMLButtonElement>()
const id = useId()
const count = computed(() => Number(props.cameraConnected) + Number(props.nvrConnected))
async function toggle() {
  open.value = !open.value
  if (!open.value) return
  if (!props.ports.length) emit('refresh')
  await nextTick(); panel.value?.querySelector<HTMLSelectElement>('select:not(:disabled)')?.focus()
}
function outside(event: PointerEvent) { if (event.target instanceof Node && !host.value?.contains(event.target)) open.value = false }
function keydown(event: KeyboardEvent) { if (event.key === 'Escape' && open.value) { open.value = false; trigger.value?.focus(); event.preventDefault() } }
onMounted(() => { document.addEventListener('pointerdown', outside); document.addEventListener('keydown', keydown) })
onUnmounted(() => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', keydown) })
</script>

<template>
  <div ref="host" class="serial-source-menu">
    <button ref="trigger" type="button" class="serial-source-trigger" :class="{ connected: count > 0, active: open }" :aria-expanded="open" :aria-controls="`${id}-sources`" aria-haspopup="dialog" @click="toggle"><span aria-hidden="true">⌁</span> Serial sources <small v-if="count">{{ count }}</small><span class="chevron" aria-hidden="true">⌄</span></button>
    <div v-if="open" :id="`${id}-sources`" ref="panel" class="serial-source-panel" role="dialog" :aria-labelledby="`${id}-title`">
      <div class="source-panel-heading"><h2 :id="`${id}-title`">Serial sources</h2><button type="button" class="icon-button" aria-label="Close serial sources" @click="open = false; trigger?.focus()">×</button></div>
      <section><h3><i class="status-dot" :class="{ offline: !cameraConnected }"></i> Cameras & monitor switchers</h3><SerialConnection line="camera" :ports="ports" :path="cameraPath" :baud-rate="cameraBaud" :connected="cameraConnected" :connected-path="cameraConnectedPath" :busy="cameraBusy" :bridge-connected="bridgeConnected" :error="cameraError" :refreshing="refreshing" :ports-error="portsError" @update:path="emit('update:cameraPath', $event)" @update:baud-rate="emit('update:cameraBaud', $event)" @toggle="(path, baud) => emit('camera', path, baud)" @refresh="emit('refresh')" /></section>
      <section><h3><i class="status-dot" :class="{ offline: !nvrConnected }"></i> NVR</h3><SerialConnection line="nvr" :ports="ports" :path="nvrPath" :baud-rate="nvrBaud" :connected="nvrConnected" :connected-path="nvrConnectedPath" :busy="nvrBusy" :bridge-connected="bridgeConnected" :error="nvrError" :refreshing="refreshing" :ports-error="portsError" @update:path="emit('update:nvrPath', $event)" @update:baud-rate="emit('update:nvrBaud', $event)" @toggle="(path, baud) => emit('nvr', path, baud)" @refresh="emit('refresh')" /></section>
      <p class="source-panel-note">Both connections receive only. Use separate devices for the camera bus and NVR.</p>
    </div>
  </div>
</template>

<style scoped>
.serial-source-menu{position:relative;font-size:11px}.serial-source-trigger{display:flex;align-items:center;gap:7px;border:1px solid #354b59;border-radius:5px;background:#1d2b35;color:#b4cbd8;padding:8px 10px;white-space:nowrap;min-height:35px;font-size:10px}.serial-source-trigger>span:first-child{font-size:16px;color:#83aebe}.serial-source-trigger.active,.serial-source-trigger:hover{border-color:#648c7a;background:#233c32}.serial-source-trigger.connected{color:var(--mint);border-color:#487d65}.serial-source-trigger small{font-family:var(--mono);font-size:8px;background:#335342;color:var(--mint);border-radius:3px;padding:2px 4px}.chevron{font-size:14px;color:#6e93a6}.serial-source-panel{position:absolute;z-index:100;right:0;top:calc(100% + 13px);width:380px;max-width:calc(100vw - 32px);max-height:calc(100dvh - 95px);overflow-y:auto;background:#18232d;border:1px solid #425663;border-radius:8px;box-shadow:0 20px 55px #0009;white-space:normal}.source-panel-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;border-bottom:1px solid var(--line);padding:12px 16px}.source-panel-heading h2{font-size:13px;font-weight:500;color:#d4e6ee;margin:0}.source-panel-heading .icon-button{width:25px;height:25px;font-size:19px}.serial-source-panel section{padding:16px;border-bottom:1px solid #30434f}.serial-source-panel h3{font-size:11px;color:#b7d0dd;display:flex;align-items:center;gap:8px;margin:0 0 17px}.source-panel-note{padding:12px 16px;margin:0;color:#728fa2;font-size:9px;line-height:1.7}@media(max-width:620px){.serial-source-trigger{padding:7px 8px;gap:5px;font-size:9px}.serial-source-trigger>span:first-child{display:none}}
</style>

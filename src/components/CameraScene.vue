<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import type { CameraState } from '../simulation/camera'
import { createPtzCamera } from '../scene/ptzCamera'
import { createThermalView, type HeatSource } from '../scene/thermalView'
import { findPalette } from '../simulation/thermalPalettes'

const props = defineProps<{ camera: CameraState; showFrustum: boolean }>()
const host = ref<HTMLDivElement>()
const fullscreenButton = ref<HTMLButtonElement>()
const isFullscreen = ref(false)
const error = ref('')
let dispose = () => {}
let resetView = () => {}
let nativeFullscreen = false
let previousOverflow = ''
function setFullscreen(active: boolean) {
  if (isFullscreen.value === active) return
  if (active) {
    previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
  } else document.body.style.overflow = previousOverflow
  isFullscreen.value = active
}
async function exitFullscreen() {
  if (document.fullscreenElement === host.value) {
    try { await document.exitFullscreen() } catch { /* Keep the in-page exit available. */ }
  }
  nativeFullscreen = false
  setFullscreen(false)
  fullscreenButton.value?.focus({ preventScroll: true })
}
async function toggleFullscreen() {
  if (isFullscreen.value) { await exitFullscreen(); return }
  setFullscreen(true)
  try {
    // The fixed viewport also works in embedded browsers that deny native fullscreen.
    await host.value?.requestFullscreen?.()
  } catch { /* The scene already fills the viewport through its fullscreen class. */ }
}
function onFullscreenChange() {
  if (document.fullscreenElement === host.value) {
    nativeFullscreen = true
    setFullscreen(true)
  } else if (nativeFullscreen) {
    nativeFullscreen = false
    setFullscreen(false)
    fullscreenButton.value?.focus({ preventScroll: true })
  }
}
function onFullscreenKey(event: KeyboardEvent) {
  if (!isFullscreen.value) return
  if (event.key === 'Escape') { event.preventDefault(); void exitFullscreen() }
  else if (event.key === 'Tab') { event.preventDefault(); fullscreenButton.value?.focus() }
}
defineExpose({ resetView: () => resetView() })
onMounted(() => {
  if (!host.value) return
  document.addEventListener('fullscreenchange', onFullscreenChange)
  document.addEventListener('keydown', onFullscreenKey)
  const element = host.value
  try {
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.setClearColor(0x131c24)
    element.appendChild(renderer.domElement)
    const scene = new THREE.Scene()
    scene.fog = new THREE.Fog(0x131c24, 22, 65)
    scene.add(new THREE.HemisphereLight(0xcde6ff, 0x283236, 2.8))
    const light = new THREE.DirectionalLight(0xffffff, 4)
    light.position.set(5, 15, 9); light.castShadow = true
    light.shadow.mapSize.set(2048, 2048)
    light.shadow.camera.left = -20; light.shadow.camera.right = 20
    light.shadow.camera.top = 20; light.shadow.camera.bottom = -20
    scene.add(light)
    const view = new THREE.PerspectiveCamera(42, 1, 0.1, 100)
    const controls = new OrbitControls(view, renderer.domElement)
    controls.enableDamping = true; controls.maxPolarAngle = Math.PI / 2 - 0.04
    controls.minDistance = 3; controls.maxDistance = 40
    resetView = () => { view.position.set(3.4, 3.6, 5.8); controls.target.set(0, 1.80, 0); controls.update() }
    resetView()
    const dark = new THREE.MeshStandardMaterial({ color: 0x25333d, metalness: 0.6, roughness: 0.35 })
    function mesh(geometry: THREE.BufferGeometry, material: THREE.Material, parent: THREE.Object3D, x = 0, y = 0, z = 0) {
      const item = new THREE.Mesh(geometry, material)
      item.position.set(x, y, z); item.castShadow = true; item.receiveShadow = true
      parent.add(item); return item
    }
    const ground = mesh(new THREE.PlaneGeometry(120, 120), new THREE.MeshStandardMaterial({ color: 0x18242b, roughness: 1 }), scene)
    ground.rotation.x = -Math.PI / 2
    const grid = new THREE.GridHelper(60, 60, 0x344b57, 0x243840)
    grid.position.y = 0.01; scene.add(grid)
    const { pan, tilt, ledMaterial, lensAnchor } = createPtzCamera(scene)
    const lamp = new THREE.SpotLight(0xffe6b4, 0, 30, Math.PI / 7, 0.5, 2)
    lamp.position.set(0.4, -0.25, 0.82)
    lamp.target.position.set(0.4, -0.25, 14)
    tilt.add(lamp); tilt.add(lamp.target)
    const lampGlowMaterial = new THREE.MeshBasicMaterial({ color: 0xffedc0 })
    const lampGlow = mesh(new THREE.SphereGeometry(0.025, 12, 12), lampGlowMaterial, tilt, 0.42, -0.2, 0.65)
    const lampBeamMaterial = new THREE.MeshBasicMaterial({ color: 0xffe6b4, transparent: true, opacity: 0.035, depthWrite: false, side: THREE.DoubleSide })
    const lampBeam = mesh(new THREE.CylinderGeometry(0, 3.5, 12, 32, 1, true), lampBeamMaterial, tilt, 0.4, -0.25, 6.82)
    lampBeam.rotation.x = -Math.PI / 2; lampBeam.castShadow = false; lampBeam.receiveShadow = false
    const frustumGeometry = new THREE.BufferGeometry()
    const frustumPositions = new THREE.Float32BufferAttribute(new Float32Array(48), 3)
    frustumPositions.setUsage(THREE.DynamicDrawUsage)
    frustumGeometry.setAttribute('position', frustumPositions)
    const frustum = new THREE.LineSegments(frustumGeometry, new THREE.LineBasicMaterial({ color: 0x55dec2, transparent: true, opacity: 0.5 }))
    frustum.position.copy(lensAnchor); tilt.add(frustum)
    const cameraView = new THREE.PerspectiveCamera(60, 16 / 9, 0.05, 100)
    cameraView.position.copy(lensAnchor); cameraView.rotation.y = Math.PI; tilt.add(cameraView)
    const heatSources: HeatSource[] = [{ object: ground, heat: 0.15 }]
    // Synthetic heat values are separate from visible colour and lamp illumination.
    // Calibration objects make pan, tilt and changing field of view easy to see.
    for (let index = 0; index < 12; index++) {
      const angle = index / 12 * Math.PI * 2
      const marker = new THREE.Group(); scene.add(marker)
      heatSources.push({ object: marker, heat: 0.25 + index / 11 * 0.67 })
      marker.position.set(Math.sin(angle) * 18, 0, Math.cos(angle) * 18)
      marker.rotation.y = angle + Math.PI
      const color = new THREE.Color().setHSL(index / 12, 0.28, 0.42)
      mesh(new THREE.BoxGeometry(2.2, 2 + index % 3, 1.4), new THREE.MeshStandardMaterial({ color }), marker, 0, (2 + index % 3) / 2)
      mesh(new THREE.BoxGeometry(0.12, 5.5, 0.12), dark, marker, 1.65, 2.75).userData.heat = 0.17
      const board = document.createElement('canvas'); board.width = 256; board.height = 256
      const context = board.getContext('2d')!
      context.fillStyle = '#dce6e8'; context.fillRect(0, 0, 256, 256)
      context.fillStyle = '#17252e'; context.font = 'bold 100px monospace'; context.textAlign = 'center'
      context.fillText(String(index * 30).padStart(3, '0'), 128, 145)
      context.font = '24px monospace'; context.fillText('DEGREES', 128, 194)
      const texture = new THREE.CanvasTexture(board); texture.colorSpace = THREE.SRGBColorSpace
      const labelMaterial = new THREE.MeshBasicMaterial({ map: texture })
      mesh(new THREE.PlaneGeometry(1.4, 1.4), labelMaterial, marker, 1.65, 5.4, 0.09).userData.heat = 0.22
      const backLabel = mesh(new THREE.PlaneGeometry(1.4, 1.4), labelMaterial, marker, 1.65, 5.4, -0.09)
      backLabel.rotation.y = Math.PI
      backLabel.userData.heat = 0.22
    }
    const thermalView = createThermalView(heatSources)
    let width = 1; let height = 1; let frame = 0; let lastFov = -1
    const resize = new ResizeObserver(() => {
      width = element.clientWidth; height = element.clientHeight
      renderer.setSize(width, height); view.aspect = width / height; view.updateProjectionMatrix()
      element.style.setProperty('--lens-height', `${Math.min(width * 0.36, 280) * 9 / 16}px`)
    })
    resize.observe(element)
    function render() {
      frame = requestAnimationFrame(render)
      pan.rotation.y = THREE.MathUtils.degToRad(props.camera.pan)
      tilt.rotation.x = -THREE.MathUtils.degToRad(props.camera.tilt)
      ledMaterial.color.set(props.camera.power ? 0x58dec0 : 0xee665e)
      const lampEnabled = props.camera.lampOn && props.camera.power
      // Keep the light in the shader configuration so a toggle only changes uniforms.
      lamp.intensity = lampEnabled ? 900 : 0
      lampGlow.visible = lampEnabled; lampBeam.visible = lampEnabled
      const fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(Math.PI / 6) / props.camera.zoom))
      if (Math.abs(lastFov - fov) > 0.005) {
        cameraView.fov = fov; cameraView.updateProjectionMatrix(); lastFov = fov
        const distance = 7; const halfHeight = distance * Math.tan(THREE.MathUtils.degToRad(fov / 2)); const halfWidth = halfHeight * 16 / 9
        const corners = [[-halfWidth, -halfHeight, distance], [halfWidth, -halfHeight, distance], [halfWidth, halfHeight, distance], [-halfWidth, halfHeight, distance]]
        const vertices: number[] = []
        corners.forEach((corner, i) => vertices.push(0, 0, 0, ...corner, ...corner, ...corners[(i + 1) % 4]))
        frustumPositions.array.set(vertices); frustumPositions.needsUpdate = true; frustumGeometry.computeBoundingSphere()
      }
      frustum.visible = props.showFrustum && props.camera.power
      controls.update()
      renderer.setScissorTest(false); renderer.setViewport(0, 0, width, height); renderer.render(scene, view)
      const insetWidth = Math.min(width * 0.36, 280); const insetHeight = insetWidth * 9 / 16
      renderer.setScissorTest(true); renderer.setViewport(width - insetWidth - 20, 20, insetWidth, insetHeight)
      renderer.setScissor(width - insetWidth - 20, 20, insetWidth, insetHeight)
      frustum.visible = false
      if (props.camera.power && props.camera.thermalEnabled) thermalView.render(renderer, cameraView, props.camera.thermalPalette, props.camera.thermalInverted, Math.ceil(insetWidth * renderer.getPixelRatio()), Math.ceil(insetHeight * renderer.getPixelRatio()))
      else if (props.camera.power) {
        lampGlow.visible = false; lampBeam.visible = false
        renderer.render(scene, cameraView)
      }
      else { renderer.setClearColor(0x080c10); renderer.clear(); renderer.setClearColor(0x131c24) }
      renderer.setScissorTest(false)
    }
    render()
    dispose = () => {
      cancelAnimationFrame(frame); resize.disconnect(); controls.dispose()
      thermalView.dispose()
      scene.traverse(object => {
        if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
          object.geometry.dispose()
          const materials = Array.isArray(object.material) ? object.material : [object.material]
          for (const material of materials) { if ('map' in material && material.map instanceof THREE.Texture) material.map.dispose(); material.dispose() }
        }
      })
      renderer.dispose(); renderer.domElement.remove()
    }
  } catch (failure) { error.value = `3D view unavailable: ${failure instanceof Error ? failure.message : 'WebGL could not start'}. Packet decoding remains available.` }
})
onUnmounted(() => {
  document.removeEventListener('fullscreenchange', onFullscreenChange)
  document.removeEventListener('keydown', onFullscreenKey)
  if (document.fullscreenElement === host.value) void document.exitFullscreen().catch(() => {})
  setFullscreen(false)
  dispose()
})
</script>

<template>
  <div ref="host" class="scene-host" :class="{ 'is-fullscreen': isFullscreen }" :role="isFullscreen ? 'dialog' : undefined" :aria-modal="isFullscreen ? true : undefined" aria-label="Interactive 3D pan tilt camera simulator">
    <div class="scene-top">
      <span class="scene-caption"><i class="status-dot"></i> LIVE SIMULATION</span>
      <div class="scene-actions">
        <span class="scene-hint">Drag to orbit · Scroll to zoom</span>
        <button ref="fullscreenButton" type="button" class="icon-button scene-fullscreen-button" :aria-label="isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'" :title="isFullscreen ? 'Exit fullscreen (Esc)' : 'Enter fullscreen'" :aria-pressed="isFullscreen" @click="toggleFullscreen">
          <svg v-if="!isFullscreen" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5" /></svg>
          <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M3 8h5V3M21 8h-5V3M8 21v-5H3M16 21v-5h5" /></svg>
        </button>
      </div>
    </div>
    <div class="scene-axis"><span class="axis-y">Y</span><span class="axis-z">Z</span><span class="axis-x">X</span></div>
    <div class="lens-caption">{{ camera.thermalEnabled ? findPalette(camera.thermalPalette).name.toUpperCase() : 'CAMERA VIEW' }} <span>{{ camera.power ? `${camera.zoom.toFixed(1)}×` : 'OFFLINE' }}</span></div>
    <p v-if="error" class="webgl-error" role="alert">{{ error }}</p>
  </div>
</template>

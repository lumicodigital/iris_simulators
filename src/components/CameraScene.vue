<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import type { CameraState } from '../simulation/camera'

const props = defineProps<{ camera: CameraState; showFrustum: boolean }>()
const host = ref<HTMLDivElement>()
const error = ref('')
let dispose = () => {}
let resetView = () => {}
defineExpose({ resetView: () => resetView() })
onMounted(() => {
  if (!host.value) return
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
    resetView = () => { view.position.set(6.5, 6, 9); controls.target.set(0, 2.8, 0); controls.update() }
    resetView()
    const grey = new THREE.MeshStandardMaterial({ color: 0xe4e9e9, metalness: 0.45, roughness: 0.3 })
    const dark = new THREE.MeshStandardMaterial({ color: 0x25333d, metalness: 0.6, roughness: 0.35 })
    const glass = new THREE.MeshStandardMaterial({ color: 0x125474, metalness: 0.8, roughness: 0.12 })
    function mesh(geometry: THREE.BufferGeometry, material: THREE.Material, parent: THREE.Object3D, x = 0, y = 0, z = 0) {
      const item = new THREE.Mesh(geometry, material)
      item.position.set(x, y, z); item.castShadow = true; item.receiveShadow = true
      parent.add(item); return item
    }
    const ground = mesh(new THREE.PlaneGeometry(120, 120), new THREE.MeshStandardMaterial({ color: 0x18242b, roughness: 1 }), scene)
    ground.rotation.x = -Math.PI / 2
    const grid = new THREE.GridHelper(60, 60, 0x344b57, 0x243840)
    grid.position.y = 0.01; scene.add(grid)
    const pedestal = new THREE.Group(); scene.add(pedestal)
    mesh(new THREE.CylinderGeometry(0.72, 0.85, 0.18, 48), dark, pedestal, 0, 0.11)
    mesh(new THREE.CylinderGeometry(0.18, 0.24, 2.8, 32), dark, pedestal, 0, 1.55)
    mesh(new THREE.CylinderGeometry(0.58, 0.48, 0.24, 48), grey, pedestal, 0, 3)
    const pan = new THREE.Group(); pan.position.y = 3.16; scene.add(pan)
    mesh(new THREE.CylinderGeometry(0.46, 0.5, 0.27, 48), dark, pan, 0, 0.1)
    mesh(new THREE.BoxGeometry(0.18, 1.12, 0.5), grey, pan, -0.69, 0.6)
    mesh(new THREE.BoxGeometry(0.18, 1.12, 0.5), grey, pan, 0.69, 0.6)
    const tilt = new THREE.Group(); tilt.position.y = 0.82; pan.add(tilt)
    mesh(new THREE.BoxGeometry(1.17, 0.9, 1.5), grey, tilt)
    mesh(new THREE.BoxGeometry(1.25, 0.12, 1.72), grey, tilt, 0, 0.48, 0.05)
    mesh(new THREE.BoxGeometry(0.96, 0.7, 0.06), dark, tilt, 0, 0, 0.78)
    const lensRing = mesh(new THREE.CylinderGeometry(0.29, 0.3, 0.22, 48), dark, tilt, 0, 0, 0.88)
    lensRing.rotation.x = Math.PI / 2
    const lens = mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.025, 48), glass, tilt, 0, 0, 1.01)
    lens.rotation.x = Math.PI / 2
    const ledMaterial = new THREE.MeshBasicMaterial({ color: 0x58dec0 })
    mesh(new THREE.SphereGeometry(0.04, 12, 12), ledMaterial, tilt, 0.39, -0.2, 0.825)
    for (let index = 0; index < 5; index++) mesh(new THREE.BoxGeometry(0.6, 0.025, 0.03), dark, tilt, 0, -0.28 + index * 0.08, -0.76)
    const frustumGeometry = new THREE.BufferGeometry()
    const frustumPositions = new THREE.Float32BufferAttribute(new Float32Array(48), 3)
    frustumPositions.setUsage(THREE.DynamicDrawUsage)
    frustumGeometry.setAttribute('position', frustumPositions)
    const frustum = new THREE.LineSegments(frustumGeometry, new THREE.LineBasicMaterial({ color: 0x55dec2, transparent: true, opacity: 0.5 }))
    frustum.position.z = 1.03; tilt.add(frustum)
    const cameraView = new THREE.PerspectiveCamera(60, 16 / 9, 0.05, 100)
    cameraView.position.z = 1.04; cameraView.rotation.y = Math.PI; tilt.add(cameraView)
    // Calibration objects make pan, tilt and changing field of view easy to see.
    for (let index = 0; index < 12; index++) {
      const angle = index / 12 * Math.PI * 2
      const marker = new THREE.Group(); scene.add(marker)
      marker.position.set(Math.sin(angle) * 18, 0, Math.cos(angle) * 18)
      marker.rotation.y = angle + Math.PI
      const color = new THREE.Color().setHSL(index / 12, 0.28, 0.42)
      mesh(new THREE.BoxGeometry(2.2, 2 + index % 3, 1.4), new THREE.MeshStandardMaterial({ color }), marker, 0, (2 + index % 3) / 2)
      mesh(new THREE.BoxGeometry(0.12, 5.5, 0.12), dark, marker, 1.65, 2.75)
      const board = document.createElement('canvas'); board.width = 256; board.height = 256
      const context = board.getContext('2d')!
      context.fillStyle = '#dce6e8'; context.fillRect(0, 0, 256, 256)
      context.fillStyle = '#17252e'; context.font = 'bold 100px monospace'; context.textAlign = 'center'
      context.fillText(String(index * 30).padStart(3, '0'), 128, 145)
      context.font = '24px monospace'; context.fillText('DEGREES', 128, 194)
      const texture = new THREE.CanvasTexture(board); texture.colorSpace = THREE.SRGBColorSpace
      const labelMaterial = new THREE.MeshBasicMaterial({ map: texture })
      mesh(new THREE.PlaneGeometry(1.4, 1.4), labelMaterial, marker, 1.65, 5.4, 0.09)
      const backLabel = mesh(new THREE.PlaneGeometry(1.4, 1.4), labelMaterial, marker, 1.65, 5.4, -0.09)
      backLabel.rotation.y = Math.PI
    }
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
      if (props.camera.power) renderer.render(scene, cameraView)
      else { renderer.setClearColor(0x080c10); renderer.clear(); renderer.setClearColor(0x131c24) }
      renderer.setScissorTest(false)
    }
    render()
    dispose = () => {
      cancelAnimationFrame(frame); resize.disconnect(); controls.dispose()
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
onUnmounted(() => dispose())
</script>

<template>
  <div ref="host" class="scene-host" aria-label="Interactive 3D pan tilt camera simulator">
    <div class="scene-top"><span class="scene-caption"><i class="status-dot"></i> LIVE SIMULATION</span><span class="scene-hint">Drag to orbit · Scroll to zoom</span></div>
    <div class="scene-axis"><span class="axis-y">Y</span><span class="axis-z">Z</span><span class="axis-x">X</span></div>
    <div class="lens-caption">CAMERA VIEW <span>{{ camera.power ? `${camera.zoom.toFixed(1)}×` : 'OFFLINE' }}</span></div>
    <p v-if="error" class="webgl-error" role="alert">{{ error }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import type { CameraState } from '../simulation/camera'
import { createPtzCamera } from '../scene/ptzCamera'
import { createThermalView, type HeatSource } from '../scene/thermalView'
import { findPalette } from '../simulation/thermalPalettes'
import type { SimulatedCamera } from '../simulation/cameras'
import { yachtMountFor, yachtRenderDistance, type SceneEnvironment, type TimeOfDay } from '../simulation/environment'
import { createYacht } from '../scene/yacht'
import { compensateGyro } from '../scene/vesselMotion'
import { createCameraEffects, type CameraEffectsSettings } from '../scene/cameraEffects'
import { createSky, maritimeSunDirection, maritimeSunDirectionFor } from '../scene/sky'
import { yachtPose } from '../simulation/maritime'

const props = withDefaults(defineProps<{ camera: CameraState; showFrustum: boolean; compact?: boolean; videoOnly?: boolean; videoActive?: boolean; videoHighQuality?: boolean; environment?: SceneEnvironment; night?: boolean; timeOfDay?: TimeOfDay; waveStrength?: number; cameras?: SimulatedCamera[]; cameraId?: string }>(), { videoActive: true })
const emit = defineEmits<{ videoFrame: [canvas: HTMLCanvasElement] }>()
const host = ref<HTMLDivElement>()
const fullscreenButton = ref<HTMLButtonElement>()
const povFullscreenButton = ref<HTMLButtonElement>()
const isFullscreen = ref(false)
const fullscreenView = ref<'scene' | 'pov'>('scene')
const isPovFullscreen = computed(() => isFullscreen.value && fullscreenView.value === 'pov')
const error = ref('')
const cutaway = ref(false)
const cameraIndex = computed(() => Math.max(0, props.cameras?.findIndex(item => item.id === props.cameraId) ?? 0))
const installation = computed(() => yachtMountFor(props.cameras?.[cameraIndex.value], cameraIndex.value))
let focusCamera = () => {}
let harbourView = () => {}
let dispose = () => {}
let resetView = () => {}
let nativeFullscreen = false
let previousOverflow = ''
function focusFullscreenButton() {
  const button = fullscreenView.value === 'pov' ? povFullscreenButton.value : fullscreenButton.value
  button?.focus({ preventScroll: true })
}
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
  focusFullscreenButton()
}
async function toggleFullscreen(view: 'scene' | 'pov') {
  if (isFullscreen.value && fullscreenView.value === view) { await exitFullscreen(); return }
  fullscreenView.value = view
  if (isFullscreen.value) return
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
    focusFullscreenButton()
  }
}
function onFullscreenKey(event: KeyboardEvent) {
  if (!isFullscreen.value) return
  if (event.key === 'Escape') { event.preventDefault(); void exitFullscreen() }
  else if (event.key === 'Tab') { event.preventDefault(); focusFullscreenButton() }
}
defineExpose({ resetView: () => resetView() })
onMounted(() => {
  if (!host.value) return
  document.addEventListener('fullscreenchange', onFullscreenChange)
  document.addEventListener('keydown', onFullscreenKey)
  const element = host.value
  try {
    const aboard = props.environment === 'yacht'
    // Millimetre camera details and distant shorelines need the same depth buffer.
    const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: aboard })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, props.videoOnly ? 1 : props.compact ? 1.5 : 2))
    renderer.shadowMap.enabled = !props.videoOnly || Boolean(props.videoHighQuality)
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.setClearColor(0x131c24)
    element.appendChild(renderer.domElement)
    const scene = new THREE.Scene()
    const sky = aboard ? createSky(scene) : undefined
    if (aboard) scene.background = new THREE.Color(0xb5d3df)
    // Keep the yacht's full coastal scene clear, including distant zoom targets.
    scene.fog = aboard ? null : new THREE.Fog(0x131c24, 22, 65)
    const ambient = new THREE.HemisphereLight(0xcde6ff, 0x283236, 2.8); scene.add(ambient)
    const light = new THREE.DirectionalLight(0xffffff, 4)
    light.position.set(aboard ? 25 : 5, aboard ? 55 : 15, aboard ? 20 : 9); light.castShadow = true
    if (aboard) light.position.copy(maritimeSunDirection).multiplyScalar(65)
    const shadowSize = props.videoHighQuality || !props.compact ? 2048 : 1024
    light.shadow.mapSize.set(shadowSize, shadowSize)
    light.shadow.camera.left = aboard ? -35 : -20; light.shadow.camera.right = aboard ? 35 : 20
    light.shadow.camera.top = aboard ? 35 : 20; light.shadow.camera.bottom = aboard ? -35 : -20
    light.shadow.camera.far = 120; light.shadow.normalBias = 0.035
    scene.add(light, light.target)
    const view = new THREE.PerspectiveCamera(42, 1, 0.05, aboard ? yachtRenderDistance : 100)
    view.layers.enable(1) // Observer annotations stay out of reflections and live video.
    view.layers.enable(2)
    const controls = new OrbitControls(view, renderer.domElement)
    controls.enableDamping = true; controls.maxPolarAngle = Math.PI / 2 - 0.04
    controls.minDistance = aboard ? 1.2 : 3; controls.maxDistance = aboard ? 6500 : 40
    let followYacht = true
    const observedYacht = new THREE.Vector3(); const followDelta = new THREE.Vector3()
    harbourView = () => { followYacht = false; cutaway.value = false; view.position.set(550, 330, 260); controls.target.set(-120, 65, 820); controls.update() }
    resetView = () => {
      if (aboard) {
        const pose = yachtPose(performance.now() / 1000)
        observedYacht.set(pose.x, 0, pose.z); followYacht = true
        view.position.set(34, 24, 37).add(observedYacht); controls.target.set(0, 3.3, 0).add(observedYacht); cutaway.value = false
      }
      else { view.position.set(3.4, 3.6, 5.8); controls.target.set(0, 1.80, 0) }
      controls.update()
    }
    focusCamera = () => {
      const [x, y, z] = installation.value.position
      const inside = installation.value.id === 'boiler-room'
      cutaway.value = inside
      vessel.updateMatrixWorld(true)
      controls.target.copy(vessel.localToWorld(new THREE.Vector3(inside ? 0 : x, inside ? -0.1 : y + 0.3, inside ? -6 : z)))
      view.position.copy(vessel.localToWorld(new THREE.Vector3(x + (inside ? 7 : 4), y + (inside ? 7 : 3), z + (inside ? 8 : 5))))
      observedYacht.set(vessel.position.x, 0, vessel.position.z); followYacht = true
      controls.update()
    }
    resetView()
    const dark = new THREE.MeshStandardMaterial({ color: 0x25333d, metalness: 0.6, roughness: 0.35 })
    function mesh(geometry: THREE.BufferGeometry, material: THREE.Material, parent: THREE.Object3D, x = 0, y = 0, z = 0) {
      const item = new THREE.Mesh(geometry, material)
      item.position.set(x, y, z); item.castShadow = true; item.receiveShadow = true
      parent.add(item); return item
    }
    const yacht = aboard ? createYacht(scene, props.videoHighQuality || (!props.compact && !props.videoOnly) ? 384 : 128) : undefined
    yacht?.update(performance.now() / 1000, props.waveStrength ?? 1)
    const heatSources: HeatSource[] = yacht ? yacht.heatSources : []
    let ground: THREE.Mesh | undefined
    if (!aboard) {
      ground = mesh(new THREE.PlaneGeometry(120, 120), new THREE.MeshStandardMaterial({ color: 0x18242b, roughness: 1 }), scene)
      ground.rotation.x = -Math.PI / 2
      const grid = new THREE.GridHelper(60, 60, 0x344b57, 0x243840)
      grid.position.y = 0.01; scene.add(grid)
      heatSources.push({ object: ground, heat: 0.15 })
    }
    const vessel = yacht?.vessel ?? scene
    const cameraInstallation = new THREE.Group(); vessel.add(cameraInstallation); cameraInstallation.userData.thermalAnimated = true
    const { pan, tilt, ledMaterial, lensAnchor } = createPtzCamera(cameraInstallation)
    const stabilizedHead = new THREE.Group(); cameraInstallation.add(stabilizedHead); stabilizedHead.add(pan)
    for (const part of [stabilizedHead, pan, tilt]) part.userData.thermalAnimated = true
    const cameraModelScale = aboard ? 0.18 : 1
    cameraInstallation.scale.setScalar(cameraModelScale)
    const peerModels = new Map<string, { root: THREE.Group; stabilizer: THREE.Group; pan: THREE.Group; tilt: THREE.Group }>()
    const peerWhite = new THREE.MeshStandardMaterial({ color: 0xe9efed, roughness: 0.45, metalness: 0.2 })
    const peerBlack = new THREE.MeshStandardMaterial({ color: 0x10232b, roughness: 0.15, metalness: 0.6 })
    const peerBase = new THREE.CylinderGeometry(0.17, 0.22, 0.12, 12)
    const peerHead = new THREE.SphereGeometry(0.16, 12, 8)
    const peerLens = new THREE.CylinderGeometry(0.07, 0.07, 0.05, 12)
    const selection = aboard && !props.videoOnly ? new THREE.Mesh(new THREE.RingGeometry(0.4, 0.48, 32), new THREE.MeshBasicMaterial({ color: 0x57edc2, transparent: true, opacity: 0.9, side: THREE.DoubleSide })) : undefined
    if (selection) { selection.rotation.x = -Math.PI / 2; selection.layers.set(1); selection.userData.thermalHidden = true; vessel.add(selection) }
    const markers = new THREE.Group(); markers.userData.thermalHidden = true; vessel.add(markers)
    const addressMarkers = new Map<string, THREE.Sprite>()
    function updateInstallations() {
      if (!aboard) return
      cameraInstallation.position.fromArray(installation.value.position)
      cameraInstallation.rotation.y = installation.value.yaw
      compensateGyro(stabilizedHead, cameraInstallation, props.camera.gyroOn, props.camera.gyroOn ? installation.value.yaw + yachtPose(props.camera.gyroStartedAt ?? 0).yaw : 0)
      if (selection) selection.position.copy(cameraInstallation.position).y += 0.03
      for (const model of peerModels.values()) model.root.visible = false
      for (const [i, camera] of (props.cameras ?? []).entries()) {
        const location = yachtMountFor(camera, i)
        if (!props.videoOnly) {
          let marker = addressMarkers.get(camera.id)
          if (!marker || marker.userData.address !== camera.address) {
            if (marker) { marker.material.map?.dispose(); marker.material.dispose(); markers.remove(marker) }
            const canvas = document.createElement('canvas'); canvas.width = 96; canvas.height = 56
            const context = canvas.getContext('2d')!
            context.fillStyle = '#12343be8'; context.fillRect(0, 0, 96, 56)
            context.strokeStyle = '#9cebd2'; context.lineWidth = 3; context.strokeRect(2, 2, 92, 52)
            context.fillStyle = '#cefff0'; context.font = 'bold 35px monospace'; context.textAlign = 'center'; context.fillText(String(camera.address).padStart(2, '0'), 48, 40)
            const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace
            marker = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true }))
            marker.layers.set(1)
            marker.scale.set(1.8, 1.05, 1); marker.userData.address = camera.address
            markers.add(marker); addressMarkers.set(camera.id, marker)
          }
          marker.position.fromArray(location.position); marker.position.y += 1.15
          marker.visible = !cutaway.value || location.id === 'boiler-room'
        }
        if (camera.id === props.cameraId) continue
        let model = peerModels.get(camera.id)
        if (!model) {
          const root = new THREE.Group(); const peerPan = new THREE.Group(); const peerTilt = new THREE.Group()
          const stabilizer = new THREE.Group(); root.add(stabilizer); stabilizer.add(peerPan); peerPan.add(peerTilt); peerTilt.position.y = 0.32; vessel.add(root)
          for (const part of [root, stabilizer, peerPan, peerTilt]) part.userData.thermalAnimated = true
          mesh(peerBase, peerWhite, root, 0, 0.06, 0)
          mesh(peerHead, peerWhite, peerTilt)
          const lens = mesh(peerLens, peerBlack, peerTilt, 0, 0.04, 0.15); lens.rotation.x = Math.PI / 2
          model = { root, stabilizer, pan: peerPan, tilt: peerTilt }; peerModels.set(camera.id, model)
        }
        model.root.visible = !cutaway.value || location.id === 'boiler-room'; model.root.position.fromArray(location.position); model.root.rotation.y = location.yaw
        compensateGyro(model.stabilizer, model.root, camera.state.gyroOn, camera.state.gyroOn ? location.yaw + yachtPose(camera.state.gyroStartedAt ?? 0).yaw : 0)
        model.pan.rotation.y = -THREE.MathUtils.degToRad(camera.state.pan)
        model.tilt.rotation.x = -THREE.MathUtils.degToRad(camera.state.tilt + (camera.state.gyroOn ? camera.state.gyroTrim : 0))
      }
      for (const [id, marker] of addressMarkers) if (!props.cameras?.some(camera => camera.id === id)) marker.visible = false
    }
    updateInstallations()
    const lamp = new THREE.SpotLight(0xffe6b4, 0, aboard ? 180 : 30, Math.PI / 7, 0.5, 2)
    lamp.position.set(0.4, -0.25, 0.82)
    lamp.target.position.set(0.4, -0.25, 14)
    tilt.add(lamp); tilt.add(lamp.target)
    const lampGlowMaterial = new THREE.MeshBasicMaterial({ color: 0xffedc0 })
    const lampGlow = mesh(new THREE.SphereGeometry(0.025, 12, 12), lampGlowMaterial, tilt, 0.42, -0.2, 0.65)
    const lampBeamMaterial = new THREE.MeshBasicMaterial({ color: 0xffe6b4, transparent: true, opacity: 0.035, depthWrite: false, side: THREE.DoubleSide })
    const lampBeam = mesh(new THREE.CylinderGeometry(0, 3.5, 12, 32, 1, true), lampBeamMaterial, tilt, 0.4, -0.25, 6.82)
    lampGlow.userData.thermalHidden = true; lampBeam.userData.thermalHidden = true
    lampBeam.rotation.x = -Math.PI / 2; lampBeam.castShadow = false; lampBeam.receiveShadow = false
    const frustumGeometry = new THREE.BufferGeometry()
    const frustumPositions = new THREE.Float32BufferAttribute(new Float32Array(48), 3)
    frustumPositions.setUsage(THREE.DynamicDrawUsage)
    frustumGeometry.setAttribute('position', frustumPositions)
    const frustum = new THREE.LineSegments(frustumGeometry, new THREE.LineBasicMaterial({ color: 0x55dec2, transparent: true, opacity: 0.5 }))
    frustum.userData.thermalHidden = true; frustum.layers.set(1)
    frustum.position.copy(lensAnchor); tilt.add(frustum)
    const cameraView = new THREE.PerspectiveCamera(60, 16 / 9, aboard ? 0.01 : 0.05, aboard ? yachtRenderDistance : 100)
    cameraView.layers.enable(2)
    // Keep lens placement on the scaled model, but measure view depth in world
    // metres: inheriting its 0.18 scale clips an 8 km scene at just 1.44 km.
    cameraView.scale.setScalar(1 / cameraModelScale)
    cameraView.position.copy(lensAnchor); cameraView.rotation.y = Math.PI; tilt.add(cameraView)
    // Synthetic heat values are separate from visible colour and lamp illumination.
    // Calibration objects make pan, tilt and changing field of view easy to see.
    for (let index = 0; !aboard && index < 12; index++) {
      const angle = index / 12 * Math.PI * 2
      const marker = new THREE.Group(); scene.add(marker)
      heatSources.push({ object: marker, heat: 0.25 + index / 11 * 0.67 })
      marker.position.set(-Math.sin(angle) * 18, 0, Math.cos(angle) * 18)
      marker.rotation.y = Math.PI - angle
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
    const thermalView = createThermalView(heatSources, sky?.thermalObject)
    const opticalView = createCameraEffects()
    const daylightLightPosition = light.position.clone()
    const sunDirection = light.position.clone().sub(light.target.position).normalize()
    let previousInstallation = installation.value.id
    let previousTimeOfDay: TimeOfDay | undefined
    if (aboard && previousInstallation === 'boiler-room') focusCamera()
    let width = 1; let height = 1; let frame = 0; let lastFov = -1; let lastRendered = 0
    let previousVideoQuality = Boolean(props.videoHighQuality)
    const resize = new ResizeObserver(() => {
      width = element.clientWidth; height = element.clientHeight
      if (!width || !height) return
      renderer.setSize(width, height); view.aspect = width / height; view.updateProjectionMatrix()
      element.style.setProperty('--lens-height', `${Math.min(width * 0.36, 280) * 9 / 16}px`)
    })
    resize.observe(element)
    function render(now = performance.now()) {
      frame = requestAnimationFrame(render)
      if (!width || !height) return
      if (props.videoOnly) {
        const quality = Boolean(props.videoHighQuality)
        if (quality !== previousVideoQuality) {
          previousVideoQuality = quality; renderer.shadowMap.enabled = quality
          light.shadow.map?.dispose(); light.shadow.map = null
          light.shadow.mapSize.set(quality ? 2048 : 1024, quality ? 2048 : 1024)
          yacht?.setReflectionSize(quality ? 384 : 128)
          scene.traverse(object => {
            if (object instanceof THREE.Mesh) for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.needsUpdate = true
          })
        }
        if (props.videoActive === false) { opticalView.releaseTargets(); thermalView.releaseTargets(); return }
        if (props.camera.thermalEnabled) opticalView.releaseTargets()
        else thermalView.releaseTargets()
      }
      if (props.compact && !isFullscreen.value && !props.videoHighQuality && now - lastRendered < 1000 / 30) return
      lastRendered = now
      const timeOfDay = props.timeOfDay ?? (props.night ? 'night' : 'day')
      const night = timeOfDay === 'night'; const goldenHour = timeOfDay === 'golden-hour'
      if (timeOfDay !== previousTimeOfDay) {
        previousTimeOfDay = timeOfDay
        ambient.intensity = night ? 0.065 : goldenHour ? 1.35 : 2.8
        ambient.color.set(night ? 0x789ac7 : goldenHour ? 0xe7b7a4 : 0xcde6ff)
        ambient.groundColor.set(night ? 0x0c1424 : goldenHour ? 0x49394d : 0x283236)
        light.intensity = night ? 0.045 : goldenHour ? 3.2 : 4
        light.color.set(night ? 0x91b7e1 : goldenHour ? 0xffbd75 : 0xffffff)
        light.shadow.camera.far = goldenHour ? 400 : 120; light.shadow.camera.updateProjectionMatrix()
        if (aboard) {
          scene.background = new THREE.Color(night ? 0x030914 : goldenHour ? 0xe9ac81 : 0xb5d3df)
          sunDirection.copy(maritimeSunDirectionFor(timeOfDay))
        } else {
          light.position.copy(daylightLightPosition)
          if (goldenHour) light.position.y = 1.8
          sunDirection.copy(light.position).sub(light.target.position).normalize()
          const background = night ? 0x030914 : goldenHour ? 0x292131 : 0x131c24
          renderer.setClearColor(background); scene.fog?.color.set(background)
        }
        yacht?.setNight(night)
        sky?.setTimeOfDay(timeOfDay)
      }
      sky?.update(now / 1000)
      yacht?.update(now / 1000, props.waveStrength ?? 1)
      if (aboard) {
        followDelta.set(vessel.position.x, 0, vessel.position.z).sub(observedYacht)
        if (followYacht) { view.position.add(followDelta); controls.target.add(followDelta) }
        observedYacht.set(vessel.position.x, 0, vessel.position.z)
        light.target.position.copy(vessel.position)
        light.position.copy(sunDirection).multiplyScalar(65).add(vessel.position)
      }
      updateInstallations()
      if (aboard && previousInstallation !== installation.value.id) {
        previousInstallation = installation.value.id
        if (previousInstallation === 'boiler-room') focusCamera()
        else resetView()
      }
      // The model faces +Z; increasing protocol pan turns to the lens's right (-X).
      pan.rotation.y = -THREE.MathUtils.degToRad(props.camera.pan)
      tilt.rotation.x = -THREE.MathUtils.degToRad(props.camera.tilt + (props.camera.gyroOn ? props.camera.gyroTrim : 0))
      ledMaterial.color.set(props.camera.power ? 0x58dec0 : 0xee665e)
      const lampEnabled = props.camera.lampOn && props.camera.power
      // Keep the light in the shader configuration so a toggle only changes uniforms.
      lamp.intensity = lampEnabled ? (aboard ? 18000 : 900) : 0
      lampGlow.visible = lampEnabled; lampBeam.visible = lampEnabled
      const fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(Math.PI / 6) / props.camera.zoom))
      if (Math.abs(lastFov - fov) > 0.005) {
        cameraView.fov = fov; cameraView.updateProjectionMatrix(); lastFov = fov
        const distance = aboard ? 7 / 0.18 : 7; const halfHeight = distance * Math.tan(THREE.MathUtils.degToRad(fov / 2)); const halfWidth = halfHeight * 16 / 9
        const corners = [[-halfWidth, -halfHeight, distance], [halfWidth, -halfHeight, distance], [halfWidth, halfHeight, distance], [-halfWidth, halfHeight, distance]]
        const vertices: number[] = []
        corners.forEach((corner, i) => vertices.push(0, 0, 0, ...corner, ...corner, ...corners[(i + 1) % 4]))
        frustumPositions.array.set(vertices); frustumPositions.needsUpdate = true; frustumGeometry.computeBoundingSphere()
      }
      frustum.visible = props.showFrustum && props.camera.power
      const effects: CameraEffectsSettings = {
        camera: props.camera, night, seconds: now / 1000, sunDirection,
        seed: (props.cameras?.[cameraIndex.value]?.address ?? 1) * 13.37,
        palette: props.camera.thermalPalette, inverted: props.camera.thermalInverted,
      }
      const povOnly = props.videoOnly || isPovFullscreen.value
      controls.enabled = !povOnly
      const feedAspect = povOnly ? width / height : 16 / 9
      if (cameraView.aspect !== feedAspect) { cameraView.aspect = feedAspect; cameraView.updateProjectionMatrix() }
      function renderFeed(feedWidth: number, feedHeight: number) {
        scene.updateMatrixWorld(true)
        if (props.camera.thermalEnabled) thermalView.render(renderer, cameraView, effects, feedWidth, feedHeight)
        else opticalView.render(renderer, scene, cameraView, effects, feedWidth, feedHeight)
      }
      if (povOnly) {
        frustum.visible = false; lampGlow.visible = false; lampBeam.visible = false
        markers.visible = false
        if (selection) selection.visible = false
        yacht?.cutaway(false)
        // Thermal rendering uses another scene; keep this attached lens camera's pose current.
        scene.updateMatrixWorld(true)
        renderer.setScissorTest(false); renderer.setViewport(0, 0, width, height)
        if (props.camera.power) renderFeed(width * renderer.getPixelRatio(), height * renderer.getPixelRatio())
        else { renderer.setClearColor(0x080c10); renderer.clear(); renderer.setClearColor(0x131c24) }
        if (props.videoOnly) emit('videoFrame', renderer.domElement)
        return
      }
      controls.update()
      markers.visible = true
      if (selection) selection.visible = true
      yacht?.cutaway(cutaway.value)
      renderer.setScissorTest(false); renderer.setViewport(0, 0, width, height); renderer.render(scene, view)
      // Only the observer gets a cutaway; live CCTV still sees the enclosed room.
      yacht?.cutaway(false)
      markers.visible = false
      if (selection) selection.visible = false
      const insetWidth = Math.min(width * 0.36, 280); const insetHeight = insetWidth * 9 / 16
      const insetOffset = props.compact && !isFullscreen.value ? 10 : 20
      renderer.setScissorTest(true); renderer.setViewport(width - insetWidth - insetOffset, insetOffset, insetWidth, insetHeight)
      renderer.setScissor(width - insetWidth - insetOffset, insetOffset, insetWidth, insetHeight)
      frustum.visible = false
      if (props.camera.power) {
        lampGlow.visible = false; lampBeam.visible = false
        renderFeed(insetWidth * renderer.getPixelRatio(), insetHeight * renderer.getPixelRatio())
      }
      else { renderer.setClearColor(0x080c10); renderer.clear(); renderer.setClearColor(0x131c24) }
      renderer.setScissorTest(false)
    }
    render()
    dispose = () => {
      cancelAnimationFrame(frame); resize.disconnect(); controls.dispose()
      yacht?.dispose()
      sky?.dispose()
      thermalView.dispose()
      opticalView.dispose()
      peerBase.dispose(); peerHead.dispose(); peerLens.dispose(); peerWhite.dispose(); peerBlack.dispose()
      scene.traverse(object => {
        if (object instanceof THREE.Sprite) { object.material.map?.dispose(); object.material.dispose() }
        if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments || object instanceof THREE.Points) {
          object.geometry.dispose()
          const materials = Array.isArray(object.material) ? object.material : [object.material]
          for (const material of materials) { if ('map' in material && material.map instanceof THREE.Texture) material.map.dispose(); material.dispose() }
        }
      })
      renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove()
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
  <div ref="host" class="scene-host" :class="{ 'is-fullscreen': isFullscreen, 'scene-pov-fullscreen': isPovFullscreen, 'scene-compact': compact }" :role="isFullscreen ? 'dialog' : undefined" :aria-modal="isFullscreen ? true : undefined" :aria-label="isPovFullscreen ? 'Camera point of view fullscreen' : 'Interactive 3D pan tilt camera simulator'">
    <div v-if="!videoOnly && !isPovFullscreen" class="scene-top">
      <span class="scene-caption"><i class="status-dot"></i> {{ environment === 'yacht' ? installation.name.toUpperCase() : 'LIVE SIMULATION' }}</span>
      <div class="scene-actions">
        <template v-if="environment === 'yacht'"><button type="button" class="scene-world-button" @click="focusCamera">Focus camera</button><button type="button" class="scene-world-button" @click="harbourView">Harbour overview</button><button type="button" class="scene-world-button" :aria-pressed="cutaway" @click="cutaway = !cutaway">{{ cutaway ? 'Close cutaway' : 'Boiler cutaway' }}</button></template>
        <span class="scene-hint">Drag to orbit · Scroll to zoom</span>
        <button ref="fullscreenButton" type="button" class="icon-button scene-fullscreen-button" :aria-label="isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'" :title="isFullscreen ? 'Exit fullscreen (Esc)' : 'Enter fullscreen'" :aria-pressed="isFullscreen" @click="toggleFullscreen('scene')">
          <svg v-if="!isFullscreen" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5" /></svg>
          <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M3 8h5V3M21 8h-5V3M8 21v-5H3M16 21v-5h5" /></svg>
        </button>
      </div>
    </div>
    <div v-if="!videoOnly && !isPovFullscreen" class="scene-axis"><span class="axis-y">Y</span><span class="axis-z">Z</span><span class="axis-x">X</span></div>
    <div v-if="!videoOnly" class="lens-caption">{{ camera.thermalEnabled ? findPalette(camera.thermalPalette).name.toUpperCase() : 'CAMERA VIEW' }} <span>{{ camera.power ? `${camera.zoom.toFixed(1)}×` : 'OFFLINE' }}</span></div>
    <button v-if="!videoOnly && !error" ref="povFullscreenButton" type="button" class="icon-button scene-fullscreen-button pov-fullscreen-button" :aria-label="isPovFullscreen ? 'Exit POV fullscreen' : 'Fullscreen camera POV'" :title="isPovFullscreen ? 'Exit POV fullscreen (Esc)' : 'Fullscreen camera POV'" :aria-pressed="isPovFullscreen" @click.stop="toggleFullscreen('pov')" @pointerdown.stop>
      <svg v-if="!isPovFullscreen" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5" /></svg>
      <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M3 8h5V3M21 8h-5V3M8 21v-5H3M16 21v-5h5" /></svg>
    </button>
    <p v-if="error" class="webgl-error" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
.scene-compact:not(.is-fullscreen) .scene-top{top:10px;left:10px;right:10px}
.scene-compact:not(.is-fullscreen) .scene-caption,.scene-compact:not(.is-fullscreen) .scene-hint,.scene-compact:not(.is-fullscreen) .scene-axis{display:none}
.scene-compact:not(.is-fullscreen) .lens-caption{right:10px;bottom:calc(var(--lens-height,60px) + 14px);font-size:7px;letter-spacing:0}
.scene-compact:not(.is-fullscreen) .scene-fullscreen-button{width:24px;height:24px}
.pov-fullscreen-button{position:absolute;right:28px;bottom:28px;z-index:1;width:28px;height:28px;box-shadow:0 2px 8px #0005}
.scene-compact:not(.is-fullscreen) .pov-fullscreen-button{right:16px;bottom:16px}
.scene-pov-fullscreen .pov-fullscreen-button{right:calc(20px + env(safe-area-inset-right));bottom:calc(20px + env(safe-area-inset-bottom));width:36px;height:36px}
.scene-pov-fullscreen .lens-caption{top:20px;left:20px;bottom:auto;right:auto;width:auto;gap:12px;padding:8px 10px;background:#101c28b8;border-radius:4px;font-size:10px;color:#c3d5df}
.scene-world-button{pointer-events:auto;border:1px solid #43606e;border-radius:4px;padding:5px 7px;background:#132a35dd;color:#c2e6df;font-size:9px;white-space:nowrap}.scene-world-button[aria-pressed=true]{background:#284e43;border-color:#76b6a0}.scene-compact:not(.is-fullscreen) .scene-world-button{display:none}
</style>

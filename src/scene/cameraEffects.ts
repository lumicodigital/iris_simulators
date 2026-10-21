import * as THREE from 'three'
import type { CameraState } from '../simulation/camera'
import { palettePixels } from '../simulation/thermalPalettes'

export interface CameraEffectsSettings {
  camera: Pick<CameraState, 'autofocus' | 'focus' | 'iris' | 'zoom'>
  night: boolean
  seconds: number
  seed?: number
  sunDirection?: THREE.Vector3
  palette?: string
  inverted?: boolean
}
const unit = (value: number) => Number.isFinite(value) ? THREE.MathUtils.clamp(value, 0, 1) : 0.5
// A logarithmic lens range gives manual focus useful near and distant positions.
export const manualFocusDistance = (focus: number) => 0.4 * Math.pow(10000, unit(focus))
export function cameraEffectsParameters(camera: CameraEffectsSettings['camera'], night: boolean, thermal: boolean) {
  const zoom = THREE.MathUtils.clamp(Number.isFinite(camera.zoom) ? camera.zoom : 1, 1, 30)
  return {
    focusDistance: manualFocusDistance(camera.focus),
    focusScale: (thermal ? 12 : 24) * Math.pow(zoom, 1.35) * (0.35 + unit(camera.iris) * 0.65),
    noise: thermal ? 0.004 : night ? 0.011 : 0.0006,
    bloomThreshold: thermal ? 0.72 : night ? 0.18 : 1.1,
    maxBlur: thermal ? 7 : 12,
    sun: !thermal && !night ? 1 : 0,
  }
}

// One sensor pass per feed. Thermal blur/noise/bloom happen on heat before palette lookup.
export function createCameraEffects(thermal = false) {
  const target = new THREE.WebGLRenderTarget(1, 1, { type: thermal ? THREE.UnsignedByteType : THREE.HalfFloatType, depthBuffer: true })
  target.depthTexture = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType)
  const pixels = palettePixels('white-hot')
  const palette = new THREE.DataTexture(pixels, 256, 1, THREE.RGBAFormat)
  palette.minFilter = THREE.LinearFilter; palette.magFilter = THREE.LinearFilter; palette.needsUpdate = true
  const material = new THREE.ShaderMaterial({
    defines: thermal ? { THERMAL_SENSOR: 1 } : {},
    uniforms: {
      sensorImage: { value: target.texture }, sensorDepth: { value: target.depthTexture },
      palette: { value: palette }, inverted: { value: false }, resolution: { value: new THREE.Vector2(1, 1) },
      nearPlane: { value: 0.01 }, farPlane: { value: 8000 }, automaticFocus: { value: true },
      logarithmicDepth: { value: false },
      focusDistance: { value: 40 }, focusScale: { value: 24 }, maxBlur: { value: 12 },
      noiseAmount: { value: 0 }, frameNumber: { value: 0 }, sensorSeed: { value: 0 },
      bloomThreshold: { value: 1.1 },
      sunPosition: { value: new THREE.Vector2(-10, -10) }, sunStrength: { value: 0 },
    },
    vertexShader: `varying vec2 imageUv; void main() { imageUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: `
      uniform sampler2D sensorImage; uniform sampler2D sensorDepth; uniform sampler2D palette;
      uniform vec2 resolution; uniform float nearPlane; uniform float farPlane; uniform bool logarithmicDepth;
      uniform bool automaticFocus; uniform float focusDistance; uniform float focusScale; uniform float maxBlur;
      uniform float noiseAmount; uniform float frameNumber; uniform float sensorSeed; uniform bool inverted;
      uniform float bloomThreshold;
      uniform vec2 sunPosition; uniform float sunStrength; varying vec2 imageUv;
      float random(vec2 p) {
        vec3 hashed = fract(vec3(p.xyx) * 0.1031 + sensorSeed * 0.013);
        hashed += dot(hashed, hashed.yzx + 33.33);
        return fract((hashed.x + hashed.y) * hashed.z);
      }
      float distanceAt(vec2 uv) {
        float depth = texture2D(sensorDepth, clamp(uv, vec2(0.0), vec2(1.0))).r;
        if (logarithmicDepth) return max(nearPlane, exp2(depth * log2(farPlane + 1.0)) - 1.0);
        return nearPlane * farPlane / max(farPlane - depth * (farPlane - nearPlane), 0.00001);
      }
      vec3 sampleImage(vec2 uv) { return texture2D(sensorImage, clamp(uv, vec2(0.0), vec2(1.0))).rgb; }
      void main() {
        vec2 pixel = 1.0 / resolution;
        float focalDistance = automaticFocus ? distanceAt(vec2(0.5)) : focusDistance;
        float depth = distanceAt(imageUv);
        float radius = min(maxBlur, abs(1.0 / max(depth, 0.1) - 1.0 / max(focalDistance, 0.1)) * focusScale);
        #ifdef THERMAL_SENSOR
          radius = max(0.45, radius);
        #endif
        vec3 value = sampleImage(imageUv);
        if (radius > 0.15) {
          // A fixed disk kernel keeps NVR split views inexpensive and avoids directional blur.
          vec3 sum = value * 2.0;
          for (int i = 0; i < 12; i++) {
            float angle = float(i) * 2.39996323;
            float ring = sqrt((float(i) + 0.5) / 12.0);
            sum += sampleImage(imageUv + vec2(cos(angle), sin(angle)) * ring * radius * pixel);
          }
          value = sum / 14.0;
        }
        vec3 glow = vec3(0.0);
        for (int i = 0; i < 8; i++) {
          float angle = float(i) * 0.78539816;
          vec3 source = sampleImage(imageUv + vec2(cos(angle), sin(angle)) * pixel * 4.0);
          #ifdef THERMAL_SENSOR
            glow += vec3(max(source.r - bloomThreshold, 0.0));
          #else
            float brightness = dot(source, vec3(0.2126, 0.7152, 0.0722));
            glow += source * max(brightness - bloomThreshold, 0.0) / max(brightness, 0.001);
          #endif
        }
        vec2 sensorPixel = floor(imageUv * resolution);
        #ifdef THERMAL_SENSOR
          // Thermal sensitivity is independent of daylight and the visible lamp.
          float grain = random(floor(sensorPixel / 2.0) + frameNumber * vec2(0.73, 0.31)) - 0.5;
          float fixedPattern = (random(vec2(sensorPixel.x, 0.0)) - 0.5) * 0.0015;
          float heat = clamp(value.r + glow.r * 0.025 + grain * noiseAmount + fixedPattern, 0.0, 1.0);
          if (inverted) heat = 1.0 - heat;
          gl_FragColor = vec4(texture2D(palette, vec2(heat, 0.5)).rgb, 1.0);
        #else
          value += glow * 0.07;
          float luminance = dot(value, vec3(0.2126, 0.7152, 0.0722));
          float shadows = 1.0 - smoothstep(0.005, 0.2, luminance);
          vec3 grain = vec3(random(sensorPixel + frameNumber * 0.71), random(sensorPixel + frameNumber * 0.83 + 19.1), random(sensorPixel + frameNumber * 0.97 + 43.7)) - 0.5;
          value = max(vec3(0.0), value + grain * noiseAmount * (0.12 + 0.88 * shadows));
          // Warm solar bloom, streaks and faint internal lens ghosts, with depth occlusion.
          vec2 aspect = vec2(resolution.x / resolution.y, 1.0);
          vec2 delta = (imageUv - sunPosition) * aspect;
          float sourceInFrame = step(0.0, sunPosition.x) * step(sunPosition.x, 1.0) * step(0.0, sunPosition.y) * step(sunPosition.y, 1.0);
          float visibleSky = step(farPlane * 0.9, distanceAt(sunPosition));
          float visibility = mix(0.35, visibleSky, sourceInFrame) * sunStrength;
          float halo = exp(-dot(delta, delta) * 180.0) * 0.22 + exp(-dot(delta, delta) * 18000.0) * 3.0;
          float streak = exp(-abs(delta.y) * 240.0) * exp(-abs(delta.x) * 13.0) * 0.13;
          vec2 ghostDelta = (imageUv - mix(sunPosition, vec2(0.5), 1.35)) * aspect;
          float ghost = exp(-dot(ghostDelta, ghostDelta) * 420.0) * 0.025;
          value += visibility * (vec3(1.0, 0.75, 0.43) * (halo + streak) + vec3(0.45, 0.68, 0.9) * ghost);
          gl_FragColor = vec4(value, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        #endif
      }`,
    depthTest: false, depthWrite: false,
  })
  const screen = new THREE.Scene()
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material); quad.frustumCulled = false; screen.add(quad)
  const screenCamera = new THREE.Camera()
  const viewport = new THREE.Vector4(); const scissor = new THREE.Vector4()
  const projectedSun = new THREE.Vector3(); const eye = new THREE.Vector3(); const forward = new THREE.Vector3()
  let selectedPalette = 'white-hot'
  return {
    render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, settings: CameraEffectsSettings, width: number, height: number) {
      width = Math.max(1, Math.ceil(width)); height = Math.max(1, Math.ceil(height))
      if (target.width !== width || target.height !== height) target.setSize(width, height)
      const params = cameraEffectsParameters(settings.camera, settings.night, thermal)
      const uniforms = material.uniforms
      uniforms.resolution.value.set(width, height); uniforms.nearPlane.value = camera.near; uniforms.farPlane.value = camera.far
      uniforms.logarithmicDepth.value = renderer.capabilities.logarithmicDepthBuffer
      uniforms.automaticFocus.value = settings.camera.autofocus; uniforms.focusDistance.value = params.focusDistance
      uniforms.focusScale.value = params.focusScale; uniforms.maxBlur.value = params.maxBlur; uniforms.noiseAmount.value = params.noise
      uniforms.bloomThreshold.value = params.bloomThreshold
      uniforms.frameNumber.value = Math.floor(settings.seconds * 30) % 4096; uniforms.sensorSeed.value = settings.seed ?? 0
      uniforms.inverted.value = Boolean(settings.inverted); uniforms.sunStrength.value = 0
      if (params.sun && settings.sunDirection) {
        camera.getWorldPosition(eye); camera.getWorldDirection(forward)
        if (forward.dot(settings.sunDirection) > 0) {
          projectedSun.copy(settings.sunDirection).multiplyScalar(camera.far * 0.5).add(eye).project(camera)
          uniforms.sunPosition.value.set(projectedSun.x * 0.5 + 0.5, projectedSun.y * 0.5 + 0.5)
          if (Math.abs(projectedSun.x) < 1.3 && Math.abs(projectedSun.y) < 1.3) uniforms.sunStrength.value = params.sun
        }
      }
      if (thermal && settings.palette && settings.palette !== selectedPalette) {
        pixels.set(palettePixels(settings.palette)); palette.needsUpdate = true; selectedPalette = settings.palette
      }
      const previousTarget = renderer.getRenderTarget(); const previousScissor = renderer.getScissorTest()
      renderer.getViewport(viewport); renderer.getScissor(scissor)
      const restore = () => {
        renderer.setRenderTarget(previousTarget)
        if (!previousTarget) { renderer.setViewport(viewport); renderer.setScissor(scissor) }
        renderer.setScissorTest(previousScissor)
      }
      try {
        // Render-target viewports use physical pixels; setViewport would apply DPR again.
        renderer.setRenderTarget(target); renderer.setScissorTest(false)
        renderer.render(scene, camera)
        restore()
        renderer.render(screen, screenCamera)
      } finally {
        restore()
      }
    },
    releaseTargets() { target.setSize(1, 1) },
    dispose() { target.dispose(); palette.dispose(); quad.geometry.dispose(); material.dispose() },
  }
}

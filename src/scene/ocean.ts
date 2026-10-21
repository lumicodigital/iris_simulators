import * as THREE from 'three'
import { Reflector } from 'three/addons/objects/Reflector.js'
import { normalizeWaveStrength } from '../simulation/environment'
import { createReflectionVisibility } from './reflectionVisibility'

const components = [
  { amplitude: 0.42, wavelength: 38, direction: 0.4, speed: 3 },
  { amplitude: 0.2, wavelength: 17, direction: 1.9, speed: 1.9 },
  { amplitude: 0.055, wavelength: 6, direction: -0.7, speed: 0.9 },
].map(wave => {
  const frequency = 2 * Math.PI / wave.wavelength
  return { amplitude: wave.amplitude, kx: Math.cos(wave.direction) * frequency, kz: Math.sin(wave.direction) * frequency, rate: frequency * wave.speed }
})

// CPU buoyancy and both visible/thermal shaders use the same travelling waves.
export function sampleOceanWaves(x: number, z: number, seconds: number, strength = 1) {
  let height = 0; let dx = 0; let dz = 0
  for (const wave of components) {
    const phase = wave.kx * x + wave.kz * z - wave.rate * seconds
    const derivative = wave.amplitude * Math.cos(phase)
    height += wave.amplitude * Math.sin(phase); dx += derivative * wave.kx; dz += derivative * wave.kz
  }
  const scale = normalizeWaveStrength(strength)
  return { height: height * scale, dx: dx * scale, dz: dz * scale }
}
export const oceanWaveShader = `
  uniform float oceanStrength;
  vec3 oceanWaves(vec2 p, float seconds) {
    vec3 result = vec3(0.0);
    ${components.map(wave => `{
      float phase = ${wave.kx.toFixed(8)} * p.x + ${wave.kz.toFixed(8)} * p.y - ${wave.rate.toFixed(8)} * seconds;
      float slope = ${wave.amplitude.toFixed(8)} * cos(phase);
      result += vec3(${wave.amplitude.toFixed(8)} * sin(phase), slope * ${wave.kx.toFixed(8)}, slope * ${wave.kz.toFixed(8)});
    }`).join('\n')}
    return result * oceanStrength;
  }
`

const oceanAxis = [...new Set([-9000, -6000, -3000, -1500, -900, -600, -450, -360,
  ...Array.from({ length: 121 }, (_, i) => -300 + i * 5), -12,
  360, 450, 600, 900, 1500, 3000, 6000, 9000])].sort((a, b) => a - b)
let surfaceTime = NaN; let surfaceStrength = NaN; let surfaceX = NaN; let surfaceZ = NaN
const surfaceHeights = new Map<number, number>()
// Foam must follow the actual triangulated surface, including the coarse distant rings.
export function sampleOceanSurface(x: number, z: number, seconds: number, strength = 1, originX = 0, originZ = 0) {
  if (surfaceTime !== seconds || surfaceStrength !== strength || surfaceX !== originX || surfaceZ !== originZ) { surfaceHeights.clear(); surfaceTime = seconds; surfaceStrength = strength; surfaceX = originX; surfaceZ = originZ }
  function cell(value: number) {
    let low = 0; let high = oceanAxis.length - 1
    while (high - low > 1) { const middle = (low + high) >> 1; if (oceanAxis[middle] <= value) low = middle; else high = middle }
    return low
  }
  const ix = cell(x - originX); const iz = cell(z - originZ)
  const tx = (x - originX - oceanAxis[ix]) / (oceanAxis[ix + 1] - oceanAxis[ix]); const tz = (z - originZ - oceanAxis[iz]) / (oceanAxis[iz + 1] - oceanAxis[iz])
  function height(a: number, b: number) {
    const key = b * oceanAxis.length + a
    let value = surfaceHeights.get(key)
    if (value === undefined) { value = sampleOceanWaves(oceanAxis[a] + originX, oceanAxis[b] + originZ, seconds, strength).height; surfaceHeights.set(key, value) }
    return value
  }
  return -0.08 + (tx + tz <= 1
    ? height(ix, iz) * (1 - tx - tz) + height(ix + 1, iz) * tx + height(ix, iz + 1) * tz
    : height(ix + 1, iz + 1) * (tx + tz - 1) + height(ix, iz + 1) * (1 - tx) + height(ix + 1, iz) * (1 - tz))
}

export function createOcean(scene: THREE.Scene, reflectionSize = 256) {
  // Dense nearby water resolves the swells; distant rings retain the 8 km view.
  const axis = oceanAxis
  const vertices: number[] = []; const indices: number[] = []
  for (const z of axis) for (const x of axis) vertices.push(x, 0, z)
  for (let z = 0; z < axis.length - 1; z++) for (let x = 0; x < axis.length - 1; x++) {
    const a = z * axis.length + x; const b = a + 1; const c = a + axis.length; const d = c + 1
    indices.push(a, c, b, b, c, d)
  }
  const geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
  geometry.setIndex(indices); geometry.computeVertexNormals()
  const material = new THREE.MeshStandardMaterial({ color: 0x267b8c, roughness: 0.48, metalness: 0.18 })
  const time = { value: 0 }
  const strength = { value: 1 }
  const origin = { value: new THREE.Vector2() }; const course = { value: 0 }
  const reflectionTexture = { value: null as THREE.Texture | null }
  const reflectionMatrix = { value: new THREE.Matrix4() }
  const reflectionEnabled = { value: 0 }
  const reflections = new Map<THREE.Camera, Reflector>()
  const visibility = createReflectionVisibility(scene, reflectionSize)
  const viewport = new THREE.Vector4(); const scissor = new THREE.Vector4()
  const inverseMirror = new THREE.Matrix4()
  const cameraPosition = new THREE.Vector3()
  const ocean = new THREE.Mesh(geometry, material); ocean.name = 'Animated ocean'
  ocean.position.y = -0.08; ocean.receiveShadow = true
  ocean.userData.heat = 0.08; ocean.userData.waveTime = time; ocean.userData.waveStrength = strength
  ocean.userData.waveOrigin = origin; ocean.userData.vesselCourse = course; ocean.userData.thermalAnimated = true; scene.add(ocean)
  ocean.onBeforeRender = (renderer, world, camera) => {
    camera.getWorldPosition(cameraPosition)
    reflectionEnabled.value = cameraPosition.y > 0 ? 1 : 0
    if (!reflectionEnabled.value) return
    let mirror = reflections.get(camera)
    if (!mirror) {
      mirror = new Reflector(new THREE.PlaneGeometry(1, 1), { textureWidth: reflectionSize, textureHeight: reflectionSize, clipBias: 0.005, multisample: 0 })
      mirror.rotation.x = -Math.PI / 2; mirror.position.y = ocean.position.y; mirror.updateMatrixWorld(true)
      reflections.set(camera, mirror)
    }
    // Refresh with each rendered view, including orbit/zoom changes between
    // simulation ticks. Compact feeds retain small textures rather than stale frames.
    const previousTarget = renderer.getRenderTarget()
    renderer.getViewport(viewport); renderer.getScissor(scissor)
    const scissorTest = renderer.getScissorTest()
    ocean.visible = false; renderer.setScissorTest(false)
    try {
      visibility.begin(renderer, camera)
      mirror.onBeforeRender(renderer, world, camera, mirror.geometry, mirror.material as THREE.Material, null as never)
    }
    finally {
      visibility.end()
      ocean.visible = true
      if (!previousTarget) { renderer.setViewport(viewport); renderer.setScissor(scissor) }
      renderer.setScissorTest(scissorTest)
    }
    const uniforms = (mirror.material as THREE.ShaderMaterial).uniforms
    reflectionTexture.value = mirror.getRenderTarget().texture
    reflectionMatrix.value.copy(uniforms.textureMatrix.value).multiply(inverseMirror.copy(mirror.matrixWorld).invert()).multiply(ocean.matrixWorld)
  }
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, { oceanTime: time, oceanStrength: strength, oceanOrigin: origin, vesselCourse: course, oceanReflection: reflectionTexture, oceanReflectionMatrix: reflectionMatrix, reflectionEnabled })
    const header = `uniform float oceanTime; uniform vec2 oceanOrigin; varying vec3 oceanPosition; varying vec4 oceanReflectionUv; ${oceanWaveShader}\n`
    shader.vertexShader = 'uniform mat4 oceanReflectionMatrix;\n' + header + shader.vertexShader
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n vec3 wave = oceanWaves(position.xz + oceanOrigin, oceanTime); objectNormal = normalize(vec3(-wave.y, 1.0, -wave.z));')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n transformed.y += wave.x; oceanPosition = transformed + vec3(oceanOrigin.x, 0.0, oceanOrigin.y); oceanReflectionUv = oceanReflectionMatrix * vec4(transformed, 1.0);')
    shader.fragmentShader = 'uniform sampler2D oceanReflection; uniform float reflectionEnabled; uniform float vesselCourse;\n' + header + shader.fragmentShader
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        vec2 relative = oceanPosition.xz - oceanOrigin;
        vec2 aboard = vec2(relative.x * cos(vesselCourse) - relative.y * sin(vesselCourse), relative.x * sin(vesselCourse) + relative.y * cos(vesselCourse));
        if (abs(aboard.x) < 5.0 && aboard.y > -12.0 && aboard.y < 0.0) discard;`)
      .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
        vec3 surfaceWave = oceanWaves(oceanPosition.xz, oceanTime);
        float distantWater = smoothstep(180.0, 1400.0, length(vViewPosition));
        surfaceWave.yz *= 1.0 - distantWater * 0.96;
        normal = normalize(mat3(viewMatrix) * vec3(-surfaceWave.y, 1.0, -surfaceWave.z));`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = max(roughnessFactor, mix(0.48, 0.9, smoothstep(180.0, 1400.0, length(vViewPosition))));')
      .replace('#include <color_fragment>', `#include <color_fragment>
        float crest = oceanWaves(oceanPosition.xz, oceanTime).x;
        float breakup = 0.55 + 0.45 * sin(oceanPosition.x * 0.7 + oceanPosition.z * 0.5 + oceanTime);
        float foam = smoothstep(0.5, 0.65, crest) * breakup;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.72, 0.84, 0.82), foam * 0.3);`)
      .replace('#include <opaque_fragment>', `
        vec3 reflected = texture2D(oceanReflection, oceanReflectionUv.xy / oceanReflectionUv.w + surfaceWave.yz * 0.018).rgb;
        float fresnel = 0.12 + 0.68 * pow(1.0 - max(dot(normal, geometryViewDir), 0.0), 3.0);
        outgoingLight = mix(outgoingLight, reflected, fresnel * reflectionEnabled * (1.0 - foam * 0.5));
        #include <opaque_fragment>`)
  }
  return {
    object: ocean,
    update(seconds: number, waveStrength = 1, pose = { x: 0, z: 0, yaw: 0 }) {
      time.value = seconds; strength.value = normalizeWaveStrength(waveStrength)
      origin.value.set(pose.x, pose.z); course.value = pose.yaw
      ocean.position.x = pose.x; ocean.position.z = pose.z
    },
    setNight(night: boolean) { material.color.set(night ? 0x102a3e : 0x267b8c) },
    setReflectionSize(value: number) {
      if (reflectionSize === value) return
      reflectionSize = value; visibility.setSize(value)
      for (const mirror of reflections.values()) mirror.getRenderTarget().setSize(value, value)
    },
    dispose() { for (const mirror of reflections.values()) { mirror.geometry.dispose(); mirror.dispose() }; reflections.clear(); visibility.dispose() },
  }
}

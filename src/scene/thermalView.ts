import * as THREE from 'three'
import { createCameraEffects, type CameraEffectsSettings } from './cameraEffects'
import { oceanWaveShader } from './ocean'

export interface HeatSource { object: THREE.Object3D; heat: number }

export function createThermalView(sources: HeatSource[], sky?: THREE.Object3D) {
  const thermalScene = new THREE.Scene()
  thermalScene.background = new THREE.Color().setRGB(0.07, 0.07, 0.07)
  if (sky) thermalScene.add(sky)
  const materials = new Map<string, THREE.ShaderMaterial>()
  const animated: { original: THREE.Object3D; clone: THREE.Object3D }[] = []
  for (const source of sources) {
    const object = source.object.clone(true)
    const originals: THREE.Object3D[] = []; source.object.traverse(child => originals.push(child))
    let index = 0
    object.traverse(child => {
      const original = originals[index++]
      if (original.userData.thermalHidden) child.visible = false
      if (original.userData.thermalAnimated) animated.push({ original, clone: child })
      if (original instanceof THREE.InstancedMesh && child instanceof THREE.InstancedMesh) {
        // Optical and thermal scenes share live per-vessel/buoy transforms.
        child.instanceMatrix = original.instanceMatrix; child.boundingSphere = original.boundingSphere
      }
      if (!(child instanceof THREE.Mesh)) return
      const heat = child.userData.heat ?? source.heat
      const waveTime = original.userData.waveTime as { value: number } | undefined
      const key = `${heat}:${waveTime ? 'ocean' : 'solid'}`
      let material = materials.get(key)
      if (!material) material = new THREE.ShaderMaterial({
        uniforms: { heat: { value: heat }, ...(waveTime ? { oceanTime: waveTime, oceanStrength: original.userData.waveStrength, oceanOrigin: original.userData.waveOrigin, vesselCourse: original.userData.vesselCourse } : {}) },
        side: THREE.DoubleSide,
        vertexShader: `${waveTime ? `uniform float oceanTime; uniform vec2 oceanOrigin; ${oceanWaveShader}` : ''}
          #include <common>
          #include <logdepthbuf_pars_vertex>
          varying vec3 surfaceNormal; varying vec3 worldPosition;
          void main() {
            vec3 point = position; vec3 normalDirection = normal;
            ${waveTime ? 'vec3 wave = oceanWaves(position.xz + oceanOrigin, oceanTime); point.y += wave.x; normalDirection = normalize(vec3(-wave.y, 1.0, -wave.z));' : ''}
            #ifdef USE_INSTANCING
              point = (instanceMatrix * vec4(point, 1.0)).xyz;
              normalDirection = mat3(instanceMatrix) * normalDirection;
            #endif
            vec4 world = modelMatrix * vec4(point, 1.0);
            surfaceNormal = normalize(mat3(modelMatrix) * normalDirection); worldPosition = world.xyz;
            gl_Position = projectionMatrix * viewMatrix * world;
            #include <logdepthbuf_vertex>
          }`,
        fragmentShader: `uniform float heat; varying vec3 surfaceNormal; varying vec3 worldPosition;
          #include <logdepthbuf_pars_fragment>
          ${waveTime ? 'uniform vec2 oceanOrigin; uniform float vesselCourse;' : ''}
          void main() {
            ${waveTime ? `vec2 relative = worldPosition.xz - oceanOrigin;
              vec2 aboard = vec2(relative.x * cos(vesselCourse) - relative.y * sin(vesselCourse), relative.x * sin(vesselCourse) + relative.y * cos(vesselCourse));
              if (abs(aboard.x) < 5.0 && aboard.y > -12.0 && aboard.y < 0.0) discard;` : ''}
            float detail = 0.012 * sin(worldPosition.x * 2.5 + worldPosition.y * 3.0);
            float value = clamp(heat + detail + 0.035 * dot(normalize(surfaceNormal), normalize(vec3(0.4, 0.8, 0.5))), 0.0, 1.0);
            gl_FragColor = vec4(vec3(value), 1.0);
            #include <logdepthbuf_fragment>
          }`,
      })
      child.material = material; materials.set(key, material)
    })
    thermalScene.add(object)
  }
  const effects = createCameraEffects(true)
  return {
    render(renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera, settings: CameraEffectsSettings, width: number, height: number) {
      for (const { original, clone } of animated) {
        clone.position.copy(original.position); clone.quaternion.copy(original.quaternion); clone.scale.copy(original.scale)
      }
      effects.render(renderer, thermalScene, camera, settings, width, height)
    },
    dispose() {
      for (const material of materials.values()) material.dispose()
      effects.dispose()
    },
  }
}

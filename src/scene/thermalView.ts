import * as THREE from 'three'
import { createCameraEffects, type CameraEffectsSettings } from './cameraEffects'
import { oceanWaveShader } from './ocean'
import { thermalSettings, temperatureForHeat } from '../simulation/thermal'

export interface HeatSource { object: THREE.Object3D; heat: number }

export function createThermalView(sources: HeatSource[], sky?: THREE.Object3D) {
  const thermalScene = new THREE.Scene()
  thermalScene.background = new THREE.Color().setRGB(0.07, 0.07, 0.07)
  if (sky) thermalScene.add(sky)
  const shared = {
    rangeLow: { value: thermalSettings.min }, rangeHigh: { value: thermalSettings.max },
    airTemperature: { value: thermalSettings.air }, seaTemperature: { value: thermalSettings.water },
    daylight: { value: 1 }, thermalTime: { value: 0 }, sunDirection: { value: new THREE.Vector3(0.4, 0.8, 0.5) },
  }
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
      const optical = original instanceof THREE.Mesh ? original.material : undefined
      const surface = (Array.isArray(optical) ? optical[0] : optical) as THREE.MeshStandardMaterial | undefined
      const glass = surface?.userData.thermalSurface === 'glass'
      const metal = !glass && (surface?.metalness ?? 0) > 0.45
      const emissivity = surface?.userData.thermalEmissivity ?? (glass ? 0.91 : metal ? 0.24 : 0.94)
      let parent: THREE.Object3D | null = original; let indoor = false
      while (parent) { if (parent.name === 'Boiler room') indoor = true; parent = parent.parent }
      const solar = indoor || heat > 0.6 ? 0 : glass ? 2 : metal ? 8 : 5
      const temperature = original.userData.temperature ?? temperatureForHeat(heat)
      const key = `${temperature}:${emissivity}:${solar}:${waveTime ? 'ocean' : 'solid'}`
      let material = materials.get(key)
      if (!material) material = new THREE.ShaderMaterial({
        uniforms: { ...shared, temperature: { value: temperature }, emissivity: { value: waveTime ? 0.97 : emissivity }, solarGain: { value: solar }, machinery: { value: heat > 0.6 ? 1 : 0 }, ...(waveTime ? { oceanTime: waveTime, oceanStrength: original.userData.waveStrength, oceanOrigin: original.userData.waveOrigin, vesselCourse: original.userData.vesselCourse } : {}) },
        side: THREE.DoubleSide,
        vertexShader: `${waveTime ? `uniform float oceanTime; uniform vec2 oceanOrigin; ${oceanWaveShader}` : ''}
          #include <common>
          #include <logdepthbuf_pars_vertex>
          varying vec3 surfaceNormal; varying vec3 worldPosition; varying vec3 surfacePoint;
          void main() {
            vec3 point = position; vec3 normalDirection = normal;
            ${waveTime ? 'vec3 wave = oceanWaves(position.xz + oceanOrigin, oceanTime); point.y += wave.x; normalDirection = normalize(vec3(-wave.y, 1.0, -wave.z));' : ''}
            #ifdef USE_INSTANCING
              point = (instanceMatrix * vec4(point, 1.0)).xyz;
              normalDirection = mat3(instanceMatrix) * normalDirection;
            #endif
            surfacePoint = position;
            vec4 world = modelMatrix * vec4(point, 1.0);
            surfaceNormal = normalize(mat3(modelMatrix) * normalDirection); worldPosition = world.xyz;
            gl_Position = projectionMatrix * viewMatrix * world;
            #include <logdepthbuf_vertex>
          }`,
        fragmentShader: `
          uniform float temperature; uniform float emissivity; uniform float solarGain; uniform float machinery;
          uniform float rangeLow; uniform float rangeHigh; uniform float airTemperature; uniform float seaTemperature;
          uniform float daylight; uniform float thermalTime; uniform vec3 sunDirection;
          varying vec3 surfaceNormal; varying vec3 worldPosition; varying vec3 surfacePoint;
          #include <logdepthbuf_pars_fragment>
          ${waveTime ? 'uniform vec2 oceanOrigin; uniform float vesselCourse;' : ''}
          float radiance(float celsius) { float kelvin = (celsius + 273.15) / 300.0; return pow(kelvin, 4.0); }
          void main() {
            ${waveTime ? `vec2 relative = worldPosition.xz - oceanOrigin;
              vec2 aboard = vec2(relative.x * cos(vesselCourse) - relative.y * sin(vesselCourse), relative.x * sin(vesselCourse) + relative.y * cos(vesselCourse));
              if (abs(aboard.x) < 5.0 && aboard.y > -12.0 && aboard.y < 0.0) discard;` : ''}
            vec3 normal = normalize(surfaceNormal);
            float facingSun = max(0.0, dot(normal, normalize(sunDirection)));
            float materialDetail = sin(surfacePoint.x * 2.3 + surfacePoint.z * 0.8) * sin(surfacePoint.y * 3.1) * 0.7;
            float surface = temperature + (airTemperature - 20.0) * (1.0 - machinery);
            surface += solarGain * daylight * facingSun - (1.0 - daylight) * 2.5 * (1.0 - machinery);
            surface += materialDetail;
            // Heat spreads away from motors and pipe centres, with slow engine cycling.
            float hotspot = exp(-dot(surfacePoint.xz, surfacePoint.xz) * 0.65);
            surface += machinery * (hotspot * 14.0 + exp(-dot(surfacePoint, surfacePoint) * 0.7) * 28.0 - min(abs(surfacePoint.y) * 4.0, 12.0) + sin(thermalTime * 0.13) * 1.2);
            ${waveTime ? `surface = seaTemperature + sin(worldPosition.x * 0.025 + worldPosition.z * 0.031) * 0.12;
              surface += length(normal.xz) * 0.4;` : ''}
            // A low-emissivity surface reflects more cold sky. Visible lamps do
            // not illuminate this field, and opaque geometry still occludes it.
            float reflected = airTemperature - mix(3.0, 19.0, max(normal.y, 0.0));
            float directionalEmissivity = emissivity;
            ${waveTime ? 'directionalEmissivity *= mix(0.72, 1.0, abs(dot(normalize(cameraPosition - worldPosition), normal)));' : ''}
            float outgoing = mix(radiance(reflected), radiance(surface), directionalEmissivity);
            float transmission = exp(-length(cameraPosition - worldPosition) * 0.00018);
            float received = mix(radiance(airTemperature), outgoing, transmission);
            float apparent = pow(max(received, 0.0001), 0.25) * 300.0 - 273.15;
            float value = clamp((apparent - rangeLow) / max(rangeHigh - rangeLow, 1.0), 0.0, 1.0);
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
      shared.rangeLow.value = Number.isFinite(thermalSettings.min) ? thermalSettings.min : 5
      shared.rangeHigh.value = Math.max(shared.rangeLow.value + 1, Number.isFinite(thermalSettings.max) ? thermalSettings.max : 45)
      shared.airTemperature.value = Number.isFinite(thermalSettings.air) ? thermalSettings.air : 20
      shared.seaTemperature.value = Number.isFinite(thermalSettings.water) ? thermalSettings.water : 17
      shared.daylight.value = settings.night ? 0 : 1; shared.thermalTime.value = settings.seconds
      if (settings.sunDirection) shared.sunDirection.value.copy(settings.sunDirection)
      thermalScene.background = new THREE.Color().setRGB(0, 0, 0)
      for (const { original, clone } of animated) {
        clone.position.copy(original.position); clone.quaternion.copy(original.quaternion); clone.scale.copy(original.scale)
      }
      effects.render(renderer, thermalScene, camera, settings, width, height)
    },
    releaseTargets() { effects.releaseTargets() },
    dispose() {
      for (const material of materials.values()) material.dispose()
      effects.dispose()
    },
  }
}

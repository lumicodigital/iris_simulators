import * as THREE from 'three'
import type { TimeOfDay } from '../simulation/environment'

// The visible sun, directional light and optical lens glare share this heading.
export const maritimeSunDirection = new THREE.Vector3(-0.42, 0.25, 0.83).normalize()
const goldenHourSunDirection = new THREE.Vector3(-0.42, 0.095, 0.83).normalize()
export const maritimeSunDirectionFor = (time: TimeOfDay) => time === 'golden-hour' ? goldenHourSunDirection : maritimeSunDirection

export function createSky(scene: THREE.Scene) {
  const uniforms = {
    skyTime: { value: 0 },
    night: { value: false },
    goldenHour: { value: 0 },
    sunDirection: { value: maritimeSunDirection.clone() },
  }
  const geometry = new THREE.SphereGeometry(1, 32, 16)
  const vertexShader = `
    varying vec3 skyDirection;
    void main() {
      skyDirection = position;
      // An infinitely distant sky follows every lens, including the water mirror.
      vec4 projected = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
      gl_Position = projected.xyww;
    }
  `
  const fragmentShader = `
    uniform float skyTime;
    uniform bool night;
    uniform float goldenHour;
    uniform vec3 sunDirection;
    varying vec3 skyDirection;
    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }
    float noise(vec2 p) {
      vec2 cell = floor(p); vec2 f = fract(p);
      vec2 blend = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(cell), hash(cell + vec2(1.0, 0.0)), blend.x),
        mix(hash(cell + vec2(0.0, 1.0)), hash(cell + vec2(1.0)), blend.x), blend.y);
    }
    float cloudNoise(vec2 p) {
      float value = 0.0; float amplitude = 0.55;
      for (int i = 0; i < 5; i++) {
        value += noise(p) * amplitude;
        p = mat2(1.6, -1.2, 1.2, 1.6) * p + vec2(17.1, 9.2);
        amplitude *= 0.48;
      }
      return value;
    }
    void main() {
      vec3 direction = normalize(skyDirection);
      float elevation = max(direction.y, 0.0);
      // Horizontal cloud layers have perspective at the horizon, without nearby
      // billboards that can intersect the yacht or be clipped by zoomed cameras.
      vec2 cloudPoint = direction.xz / max(direction.y, 0.065) * 1.65;
      cloudPoint += vec2(skyTime * 0.006, skyTime * 0.002);
      float density = cloudNoise(cloudPoint);
      float coverage = smoothstep(0.43, 0.67, density);
      coverage *= smoothstep(0.07, 0.17, direction.y);
      float sunAngle = max(dot(direction, sunDirection), 0.0);
      float disc = smoothstep(cos(0.011), cos(0.0085), sunAngle);
      #ifdef THERMAL_SKY
        // Clouds radiate more heat than clear sky; sunlight does not turn the
        // entire thermal image into the optical day's blue and white colours.
        float heat = mix(0.055 + elevation * 0.01, night ? 0.14 : 0.19, coverage);
        if (!night) heat = mix(heat, 1.0, disc * (1.0 - coverage));
        gl_FragColor = vec4(vec3(heat), 1.0);
      #else
        vec3 horizon = night ? vec3(0.006, 0.012, 0.026) : mix(vec3(0.64, 0.79, 0.88), vec3(0.98, 0.61, 0.38), goldenHour);
        vec3 zenith = night ? vec3(0.001, 0.003, 0.011) : mix(vec3(0.10, 0.31, 0.59), vec3(0.19, 0.25, 0.44), goldenHour);
        vec3 color = mix(horizon, zenith, pow(elevation, 0.45));
        color += vec3(0.36, 0.12, 0.035) * goldenHour * pow(sunAngle, 6.0) * (1.0 - smoothstep(0.0, 0.6, elevation));
        if (night) {
          vec2 starPoint = vec2(atan(direction.z, direction.x) * 80.0, asin(clamp(direction.y, -1.0, 1.0)) * 80.0);
          vec2 starCell = floor(starPoint);
          vec2 offset = vec2(hash(starCell + 2.3), hash(starCell + 7.7));
          float star = 1.0 - smoothstep(0.015, 0.075, length(fract(starPoint) - offset));
          star *= step(0.983, hash(starCell)) * smoothstep(0.02, 0.15, direction.y);
          color += vec3(0.55, 0.67, 0.88) * star;
        }
        float rim = pow(sunAngle, 6.0) * 0.12;
        vec3 cloudShade = mix(vec3(0.53, 0.63, 0.73), vec3(1.0, 0.98, 0.93), smoothstep(0.46, 0.76, density));
        cloudShade = mix(cloudShade, mix(vec3(0.48, 0.32, 0.40), vec3(1.0, 0.75, 0.49), smoothstep(0.46, 0.76, density)), goldenHour);
        cloudShade += rim;
        if (night) cloudShade = mix(vec3(0.009, 0.015, 0.027), vec3(0.023, 0.033, 0.052), density);
        color = mix(color, cloudShade, coverage * 0.97);
        if (!night) {
          float halo = pow(sunAngle, 180.0) * mix(0.28, 0.55, goldenHour);
          vec3 sunColor = mix(vec3(5.0, 4.0, 2.5), vec3(5.0, 2.3, 0.7), goldenHour);
          color += (sunColor * disc + vec3(1.0, 0.71, 0.38) * halo) * (1.0 - coverage * 0.97);
        }
        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      #endif
    }
  `
  function material(thermal = false) {
    const shader = new THREE.ShaderMaterial({
      uniforms, vertexShader, fragmentShader,
      defines: thermal ? { THERMAL_SKY: 1 } : {},
      side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: false,
    })
    shader.userData.reflectionSky = true
    return shader
  }
  function dome(shader: THREE.ShaderMaterial) {
    const object = new THREE.Mesh(geometry, shader)
    object.name = 'Sun and drifting clouds'; object.frustumCulled = false; object.renderOrder = -1000
    return object
  }
  const optical = dome(material()); scene.add(optical)
  const thermalObject = dome(material(true))
  return {
    thermalObject,
    setTimeOfDay(value: TimeOfDay) {
      uniforms.night.value = value === 'night'; uniforms.goldenHour.value = value === 'golden-hour' ? 1 : 0
      uniforms.sunDirection.value.copy(maritimeSunDirectionFor(value))
    },
    update(seconds: number) { uniforms.skyTime.value = seconds },
    // The main scene owns the shared geometry and optical material.
    dispose() { thermalObject.material.dispose() },
  }
}

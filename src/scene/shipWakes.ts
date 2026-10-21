import * as THREE from 'three'
import { cargoPose, cargoRoutes, trafficFleet, trafficPose, yachtPose } from '../simulation/maritime'
import { sampleOceanSurface } from './ocean'

export function createShipWakes(scene: THREE.Scene) {
  const time = { value: 0 }; const night = { value: 1 }
  const material = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { wakeTime: time, daylight: night },
    vertexShader: `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec2 wakeUv; varying vec3 wakePosition;
      void main() {
        wakeUv = uv; wakePosition = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: `
      #include <logdepthbuf_pars_fragment>
      uniform float wakeTime; uniform float daylight; varying vec2 wakeUv; varying vec3 wakePosition;
      void main() {
        float churn = 0.55 + 0.45 * sin(wakePosition.x * 3.7 + sin(wakePosition.z * 2.1) + wakeTime * 1.6);
        float edge = smoothstep(0.0, 0.2, wakeUv.x) * (1.0 - smoothstep(0.8, 1.0, wakeUv.x));
        float fade = pow(1.0 - wakeUv.y, 1.5) * smoothstep(0.0, 0.04, wakeUv.y);
        gl_FragColor = vec4(vec3(0.82, 0.93, 0.94) * daylight, edge * fade * (0.32 + 0.48 * churn));
        #include <logdepthbuf_fragment>
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  })
  const segments = 32
  const vessels = [
    ...cargoRoutes.map(route => ({ name: route.name, poseAt: (seconds: number) => cargoPose(route, seconds), stern: 52, beam: 8, age: 65 })),
    { name: 'IRIS Explorer', poseAt: yachtPose, stern: 27, beam: 5, age: 35 },
    ...trafficFleet.filter(vessel => !['sail', 'fishing'].includes(vessel.type)).map(vessel => ({ name: vessel.name, poseAt: (seconds: number) => trafficPose(vessel, seconds), stern: vessel.length * 0.51, beam: vessel.beam * 0.45, age: vessel.length > 50 ? 45 : 18 })),
  ]
  const ribbons = vessels.flatMap(vessel => [-1, 0, 1].map(side => {
    const positions = new Float32Array((segments + 1) * 6)
    const uv: number[] = []; const indices: number[] = []
    for (let i = 0; i <= segments; i++) { uv.push(0, i / segments, 1, i / segments); if (i < segments) { const a = i * 2; indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2) } }
    const geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage)).setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    geometry.setIndex(indices)
    const mesh = new THREE.Mesh(geometry, material); mesh.name = `${vessel.name} wake`; mesh.frustumCulled = false; scene.add(mesh)
    return { vessel, side, geometry, positions, mesh }
  }))
  return {
    setNight(value: boolean) { night.value = value ? 0.003 : 1 },
    update(seconds: number, strength: number) {
      time.value = seconds
      const own = yachtPose(seconds)
      for (const ribbon of ribbons) {
        const current = ribbon.vessel.poseAt(seconds)
        ribbon.mesh.visible = Math.hypot(current.x - own.x, current.z - own.z) < 1400
        if (!ribbon.mesh.visible) continue
        for (let i = 0; i <= segments; i++) {
          const age = i / segments * ribbon.vessel.age
          const pose = ribbon.vessel.poseAt(seconds - age)
          const forwardX = Math.sin(pose.yaw); const forwardZ = Math.cos(pose.yaw)
          const spread = ribbon.side * (ribbon.vessel.beam + age * pose.speed * 0.19)
          const width = ribbon.side === 0 ? 5 + age * 0.08 : 3 + age * 0.045
          for (let edge = 0; edge < 2; edge++) {
            const offset = spread + (edge - 0.5) * width
            const x = pose.x - forwardX * ribbon.vessel.stern + forwardZ * offset
            const z = pose.z - forwardZ * ribbon.vessel.stern - forwardX * offset
            const index = i * 6 + edge * 3
            ribbon.positions[index] = x; ribbon.positions[index + 1] = sampleOceanSurface(x, z, seconds, strength, own.x, own.z) + 0.06; ribbon.positions[index + 2] = z
          }
        }
        ribbon.geometry.attributes.position.needsUpdate = true
      }
    },
  }
}

import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { cruiseBuoys, trafficFleet, trafficPose, type VesselType } from '../simulation/maritime'
import { sampleOceanWaves } from './ocean'

const dimensions: Record<VesselType, [number, number, number]> = {
  sail: [17, 5, 1], fishing: [20, 6, 1.6], motor: [33, 8, 1.7], patrol: [17, 5, 1.3],
  tug: [22, 8.5, 2.3], ferry: [62, 16, 3.2], container: [105, 20, 7], tanker: [130, 23, 6],
}

function vesselTemplate(type: VesselType) {
  const root = new THREE.Group(); const [length, beam, height] = dimensions[type]; const deck = height * 0.65
  const paint = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0.22 }); paint.userData.tint = true
  const white = new THREE.MeshStandardMaterial({ color: 0xe5e9e1, roughness: 0.6 })
  const dark = new THREE.MeshStandardMaterial({ color: 0x253c48, roughness: 0.65 })
  const glass = new THREE.MeshStandardMaterial({ color: 0x32657b, metalness: 0.4, roughness: 0.25, emissive: 0xffce87, emissiveIntensity: 0 })
  glass.userData.thermalSurface = 'glass'
  const steel = new THREE.MeshStandardMaterial({ color: 0x96a7aa, metalness: 0.55, roughness: 0.5 })
  const wood = new THREE.MeshStandardMaterial({ color: 0x9b7958, roughness: 0.9 })
  const orange = new THREE.MeshStandardMaterial({ color: 0xdb7a3d, roughness: 0.7 })
  function mesh(geometry: THREE.BufferGeometry, material: THREE.Material, x = 0, y = 0, z = 0, heat = 0.28) {
    const object = new THREE.Mesh(geometry, material); object.position.set(x, y, z); object.userData.heat = heat; root.add(object); return object
  }
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, material: THREE.Material = white, heat = 0.28) => mesh(new THREE.BoxGeometry(w, h, d), material, x, y, z, heat)
  function pole(a: THREE.Vector3, b: THREE.Vector3, radius = 0.1, material: THREE.Material = steel) {
    const delta = b.clone().sub(a); const object = mesh(new THREE.CylinderGeometry(radius, radius, delta.length(), 6), material)
    object.position.copy(a).add(b).multiplyScalar(0.5); object.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize()); return object
  }
  const outline = new THREE.Shape(); outline.moveTo(-beam / 2, -length / 2); outline.lineTo(beam / 2, -length / 2)
  outline.lineTo(beam / 2, length * 0.23); outline.quadraticCurveTo(beam * 0.45, length * 0.43, 0, length / 2); outline.quadraticCurveTo(-beam * 0.45, length * 0.43, -beam / 2, length * 0.23); outline.closePath()
  const hull = new THREE.ExtrudeGeometry(outline, { depth: height, bevelEnabled: false, curveSegments: 7 }); hull.rotateX(Math.PI / 2); hull.translate(0, deck, 0); mesh(hull, paint)
  box(beam * 0.88, 0.22, length * 0.75, 0, deck + 0.1, -length * 0.03, type === 'sail' || type === 'motor' ? wood : dark)
  function cabin(w: number, h: number, d: number, x: number, bottom: number, z: number) {
    box(w, h, d, x, bottom + h / 2, z)
    box(w + 0.05, h * 0.36, d + 0.05, x, bottom + h * 0.65, z, glass, 0.43)
    box(w + 0.3, 0.18, d + 0.3, x, bottom + h + 0.1, z)
  }
  if (type === 'sail') {
    cabin(beam * 0.55, 0.9, length * 0.28, 0, deck, -length * 0.13)
    pole(new THREE.Vector3(0, deck, 0), new THREE.Vector3(0, length * 0.95, 0), 0.09)
    pole(new THREE.Vector3(0, deck + 1, 0), new THREE.Vector3(0, deck + 1, -length * 0.32), 0.06)
    const cloth = new THREE.MeshStandardMaterial({ color: 0xf2ead6, side: THREE.DoubleSide, roughness: 1 })
    for (const side of [-1, 1]) {
      const sail = new THREE.Shape(); sail.moveTo(0, 0); sail.lineTo(0, length * (side < 0 ? 0.7 : 0.82)); sail.lineTo(length * 0.3, 0); sail.closePath()
      const object = mesh(new THREE.ShapeGeometry(sail), cloth, 0.05, deck + 1.2, side < 0 ? 0.2 : -0.2); object.rotation.y = side * Math.PI / 2
    }
  } else if (type === 'fishing') {
    cabin(beam * 0.65, 2.2, length * 0.26, 0, deck, length * 0.16)
    for (const side of [-1, 1]) {
      pole(new THREE.Vector3(side * beam * 0.35, deck, -length * 0.35), new THREE.Vector3(side * beam * 0.35, deck + 4.2, -length * 0.3), 0.12)
      pole(new THREE.Vector3(side * beam * 0.35, deck + 3.8, -length * 0.3), new THREE.Vector3(side * beam * 0.73, deck + 5, length * 0.08), 0.1)
    }
    pole(new THREE.Vector3(-beam * 0.35, deck + 4, -length * 0.3), new THREE.Vector3(beam * 0.35, deck + 4, -length * 0.3), 0.13)
    const drum = mesh(new THREE.CylinderGeometry(0.8, 0.8, 2, 10), orange, 0, deck + 0.8, -length * 0.2); drum.rotation.z = Math.PI / 2
  } else if (type === 'motor') {
    cabin(beam * 0.74, 2.3, length * 0.42, 0, deck, length * 0.03)
    cabin(beam * 0.53, 1.6, length * 0.25, 0, deck + 2.5, -length * 0.02)
    box(beam * 0.7, 0.3, length * 0.22, 0, deck + 0.3, -length * 0.32, wood)
    box(beam * 0.45, 0.5, length * 0.09, 0, deck + 0.7, length * 0.32)
  } else if (type === 'tug' || type === 'patrol') {
    cabin(beam * 0.62, type === 'tug' ? 3 : 1.9, length * 0.34, 0, deck, length * 0.04)
    box(beam * 0.2, type === 'tug' ? 3 : 1, 1, beam * 0.25, deck + 3, -length * 0.12, orange, 0.85)
    if (type === 'tug') for (const side of [-1, 1]) for (const z of [-length * 0.3, 0, length * 0.25]) {
      const fender = mesh(new THREE.TorusGeometry(0.6, 0.22, 6, 10), dark, side * beam * 0.5, 0.5, z); fender.rotation.y = Math.PI / 2
    }
  } else if (type === 'ferry') {
    cabin(beam * 0.88, 4, length * 0.68, 0, deck, -length * 0.02)
    cabin(beam * 0.68, 2.5, length * 0.52, 0, deck + 4.2, length * 0.03)
    for (const side of [-1, 1]) for (const z of [-length * 0.2, length * 0.17]) box(1.8, 1, 5, side * beam * 0.4, deck + 5, z, orange)
    box(beam * 0.5, 0.25, 4, 0, deck + 0.2, -length * 0.47, steel)
  } else {
    cabin(beam * 0.78, 7, length * 0.16, 0, deck, -length * 0.34)
    cabin(beam * 0.83, 2.3, length * 0.17, 0, deck + 7.2, -length * 0.34)
    box(beam * 0.16, 6, 3, beam * 0.2, deck + 10, -length * 0.37, dark, 0.9)
    if (type === 'container') {
      const colors = [0xb26846, 0x46838b, 0x8eac72, 0xbba05d, 0x586e91].map(color => new THREE.MeshStandardMaterial({ color, roughness: 0.8 }))
      for (let row = 0; row < 5; row++) for (let col = 0; col < 3; col++) for (let tier = 0; tier < 2 + row % 2; tier++) box(beam * 0.25, 3.2, length * 0.105, (col - 1) * beam * 0.27, deck + 1.8 + tier * 3.4, -length * 0.17 + row * length * 0.12, colors[(row + col + tier) % 5]!)
    } else {
      for (let row = 0; row < 4; row++) {
        const tank = mesh(new THREE.CylinderGeometry(beam * 0.29, beam * 0.29, 2.5, 12), steel, 0, deck + 1.3, -length * 0.15 + row * length * 0.15, 0.36)
        mesh(new THREE.SphereGeometry(beam * 0.29, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), white, 0, tank.position.y + 1.25, tank.position.z)
      }
      for (const side of [-1, 1]) pole(new THREE.Vector3(side * beam * 0.35, deck + 1, -length * 0.23), new THREE.Vector3(side * beam * 0.35, deck + 1, length * 0.35), 0.22, orange)
    }
  }
  if (type !== 'sail') pole(new THREE.Vector3(0, deck + 1, -length * 0.1), new THREE.Vector3(0, deck + Math.max(5, length * 0.15), -length * 0.1), 0.1)
  for (const [x, z, color] of [[beam * 0.45, 0, 0xff5940], [-beam * 0.45, 0, 0x56e9ac], [0, -length * 0.43, 0xffe3ac]]) {
    const light = mesh(new THREE.SphereGeometry(type === 'container' || type === 'tanker' ? 0.55 : 0.2, 6, 4), new THREE.MeshBasicMaterial({ color, toneMapped: false }), x, deck + 2, z)
    light.userData.nightOnly = true; light.userData.thermalHidden = true
  }
  return root
}

export function createSeaTraffic(world: THREE.Group) {
  const root = new THREE.Group(); root.name = 'Cruise traffic and channel buoys'; world.add(root)
  const animated: { object: THREE.InstancedMesh; indices: number[]; nightOnly: boolean }[] = []
  const glassMaterials: THREE.MeshStandardMaterial[] = []
  const color = new THREE.Color()
  for (const type of Object.keys(dimensions) as VesselType[]) {
    const indices = trafficFleet.flatMap((vessel, i) => vessel.type === type ? [i] : [])
    const template = vesselTemplate(type); template.updateMatrixWorld(true)
    const buckets = new Map<string, { material: THREE.Material; geometry: THREE.BufferGeometry[]; heat: number; nightOnly: boolean }>()
    template.traverse(object => {
      if (!(object instanceof THREE.Mesh) || Array.isArray(object.material)) return
      const nightOnly = Boolean(object.userData.nightOnly); const heat = object.userData.heat as number
      const key = `${object.material.uuid}:${heat}:${nightOnly}`
      let bucket = buckets.get(key)
      if (!bucket) { bucket = { material: object.material, geometry: [], heat, nightOnly }; buckets.set(key, bucket) }
      const geometry = object.geometry.index ? object.geometry.toNonIndexed() : object.geometry.clone()
      bucket.geometry.push(geometry.applyMatrix4(object.matrixWorld)); object.geometry.dispose()
    })
    for (const bucket of buckets.values()) {
      const geometry = mergeGeometries(bucket.geometry)!
      bucket.geometry.forEach(item => item.dispose())
      const object = new THREE.InstancedMesh(geometry, bucket.material, indices.length)
      object.name = `${type} fleet`; object.userData.heat = bucket.heat; object.userData.thermalHidden = bucket.nightOnly; object.visible = !bucket.nightOnly
      indices.forEach((index, i) => { if (bucket.material.userData.tint) object.setColorAt(i, color.set(trafficFleet[index]!.color)) })
      root.add(object); animated.push({ object, indices, nightOnly: bucket.nightOnly })
      if (bucket.material instanceof THREE.MeshStandardMaterial && bucket.material.emissive.getHex()) glassMaterials.push(bucket.material)
    }
  }
  const buoyParts: { object: THREE.InstancedMesh; indices: number[]; nightOnly: boolean }[] = []
  const buoyMaterial = new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.15 })
  const dark = new THREE.MeshStandardMaterial({ color: 0x263b3b, roughness: 0.8 })
  for (const kind of ['can', 'cone'] as const) {
    const indices = cruiseBuoys.flatMap((buoy, i) => buoy.kind === kind ? [i] : [])
    const parts = [
      { geometry: new THREE.CylinderGeometry(0.8, 1.1, 0.7, 10).translate(0, 0.2, 0), material: buoyMaterial, tint: true },
      { geometry: kind === 'can' ? new THREE.CylinderGeometry(0.45, 0.6, 1.6, 8).translate(0, 1.35, 0) : new THREE.ConeGeometry(0.65, 1.8, 8).translate(0, 1.35, 0), material: buoyMaterial, tint: true },
      { geometry: new THREE.CylinderGeometry(0.07, 0.07, 2.9, 5).translate(0, 2, 0), material: dark, tint: false },
      { geometry: new THREE.SphereGeometry(0.25, 6, 4).translate(0, 3.5, 0), material: new THREE.MeshBasicMaterial({ toneMapped: false }), tint: true, nightOnly: true },
    ]
    for (const part of parts) {
      const object = new THREE.InstancedMesh(part.geometry, part.material, indices.length); object.name = `${kind} channel buoys`; object.userData.heat = 0.18; object.userData.thermalHidden = Boolean(part.nightOnly); object.visible = !part.nightOnly
      indices.forEach((index, i) => { if (part.tint) object.setColorAt(i, color.set(cruiseBuoys[index]!.color)) })
      root.add(object); buoyParts.push({ object, indices, nightOnly: Boolean(part.nightOnly) })
    }
  }
  const vesselMatrices = trafficFleet.map(() => new THREE.Matrix4()); const buoyMatrices = cruiseBuoys.map(() => new THREE.Matrix4())
  const position = new THREE.Vector3(); const scale = new THREE.Vector3(); const rotation = new THREE.Quaternion(); const angles = new THREE.Euler(0, 0, 0, 'YXZ')
  return {
    setNight(night: boolean) {
      for (const part of [...animated, ...buoyParts]) if (part.nightOnly) part.object.visible = night
      for (const material of glassMaterials) material.emissiveIntensity = night ? 0.65 : 0
    },
    update(seconds: number, strength: number) {
      trafficFleet.forEach((vessel, i) => {
        const pose = trafficPose(vessel, seconds); const wave = sampleOceanWaves(pose.x, pose.z, seconds, strength)
        const small = vessel.length < 35; const [length, beam] = dimensions[vessel.type]
        position.set(pose.x, wave.height * (small ? 0.65 : 0.18), pose.z)
        angles.set(-Math.atan(wave.dx * Math.sin(pose.yaw) + wave.dz * Math.cos(pose.yaw)) * (small ? 0.5 : 0.12), pose.yaw, Math.atan(wave.dx * Math.cos(pose.yaw) - wave.dz * Math.sin(pose.yaw)) * (small ? 0.4 : 0.1), 'YXZ')
        rotation.setFromEuler(angles); scale.set(vessel.beam / beam, Math.sqrt(vessel.length / length), vessel.length / length)
        vesselMatrices[i]!.compose(position, rotation, scale)
      })
      for (const part of animated) {
        part.indices.forEach((index, i) => part.object.setMatrixAt(i, vesselMatrices[index]!))
        part.object.instanceMatrix.needsUpdate = true; part.object.computeBoundingSphere()
      }
      cruiseBuoys.forEach((buoy, i) => {
        const wave = sampleOceanWaves(buoy.x, buoy.z, seconds, strength)
        position.set(buoy.x, wave.height * 0.8, buoy.z); angles.set(-Math.atan(wave.dz) * 0.7, 0, Math.atan(wave.dx) * 0.7); rotation.setFromEuler(angles)
        buoyMatrices[i]!.compose(position, rotation, scale.setScalar(1))
      })
      for (const part of buoyParts) {
        part.indices.forEach((index, i) => part.object.setMatrixAt(i, buoyMatrices[index]!))
        part.object.instanceMatrix.needsUpdate = true; part.object.computeBoundingSphere()
      }
    },
  }
}

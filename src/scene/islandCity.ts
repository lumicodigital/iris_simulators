import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { coastalIslands, islandHeight, islandBridge, spinnakerTower } from '../simulation/maritime'
import { createDistrictBuildings, type DistrictBuilding } from './districtBuildings'

export function createIslandCity(parent: THREE.Group) {
  const city = new THREE.Group(); city.name = 'Island waterfronts, skyline and Spinnaker Tower'; parent.add(city)
  const concrete = new THREE.MeshStandardMaterial({ color: 0xe5e5db, roughness: 0.75 })
  const white = new THREE.MeshStandardMaterial({ color: 0xf3f2e9, metalness: 0.18, roughness: 0.42, emissive: 0x357ab5 })
  const glass = new THREE.MeshStandardMaterial({ color: 0x275a72, metalness: 0.5, roughness: 0.24, emissive: 0x4ca6cc })
  glass.userData.thermalSurface = 'glass'
  const asphalt = new THREE.MeshStandardMaterial({ color: 0x384550, roughness: 0.95 })
  const steel = new THREE.MeshStandardMaterial({ color: 0xa1b1bb, metalness: 0.5, roughness: 0.5 })
  const lit = new THREE.MeshBasicMaterial({ color: 0xffcf81, toneMapped: false })
  const nightLights = new THREE.Group(); nightLights.visible = false; city.add(nightLights)
  function mesh(geometry: THREE.BufferGeometry, material: THREE.Material, root: THREE.Object3D, x = 0, y = 0, z = 0, heat = 0.3) {
    const item = new THREE.Mesh(geometry, material); item.position.set(x, y, z); item.userData.heat = heat; root.add(item); return item
  }
  function beam(a: THREE.Vector3, b: THREE.Vector3, radius: number, material: THREE.Material, root: THREE.Object3D) {
    const delta = b.clone().sub(a)
    const item = mesh(new THREE.CylinderGeometry(radius, radius, delta.length(), 8), material, root)
    item.position.copy(a).add(b).multiplyScalar(0.5)
    item.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize()); return item
  }
  const random = (seed: number) => { const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453; return value - Math.floor(value) }
  const buildings: DistrictBuilding[] = []
  const palette = [0xd1d6d5, 0xb9c9cf, 0xd8c8af, 0x8aabb9, 0xc2c4c0, 0xa7bdc6]
  for (const [index, island] of coastalIslands.entries()) {
    const spacing = index === 3 ? 40 : 78
    for (let x = -island.rx * 0.76; x < island.rx * 0.78; x += spacing) for (let z = -island.rz * 0.72; z < island.rz * 0.75; z += spacing) {
      const seed = x * 0.17 + z * 1.91 + index * 173
      const px = island.x + x + (random(seed) - 0.5) * 15; const pz = island.z + z + (random(seed + 3) - 0.5) * 15
      const radius = Math.hypot((px - island.x) / island.rx, (pz - island.z) / island.rz)
      if (radius > 0.8 || radius < 0.16 || random(seed + 9) < 0.14) continue
      if (Math.hypot(px - spinnakerTower.x, pz - spinnakerTower.z) < 75) continue
      // Preserve both bridge landings and the lighthouse.
      if (pz > 630 && pz < 850 && px > -175 && px < 260) continue
      const w = 21 + random(seed + 1) * 16; const d = 20 + random(seed + 2) * 16
      const heights = [-1, 1].flatMap(sx => [-1, 1].map(sz => islandHeight(island, px + sx * w / 2, pz + sz * d / 2)))
      if (Math.min(...heights) < 2) continue
      const tall = index !== 3 && random(seed + 8) > 0.69
      const h = index === 3 ? 8 + random(seed + 4) * 17 : tall ? 65 + random(seed + 4) * 105 : 12 + random(seed + 4) * 32
      buildings.push({ x: px, z: pz, w, d, h, base: Math.max(...heights) + 0.7, bottom: Math.min(...heights) - 5, color: palette[Math.floor(random(seed + 5) * palette.length)]!, seed })
    }
  }
  const district = createDistrictBuildings(city, nightLights, buildings)

  const bridge = new THREE.Group(); bridge.name = 'Island link · cable-stayed bridge'; city.add(bridge)
  const { from, to, width } = islandBridge
  const distance = Math.hypot(to.x - from.x, to.z - from.z); const yaw = Math.atan2(to.x - from.x, to.z - from.z)
  bridge.position.set(from.x, 0, from.z); bridge.rotation.y = yaw
  const startHeight = islandHeight(coastalIslands[0], from.x, from.z) + 1.5
  const endHeight = islandHeight(coastalIslands[3], to.x, to.z) + 1.5
  const deckY = (t: number) => startHeight * (1 - t) + endHeight * t + Math.sin(t * Math.PI) * islandBridge.deckHeight * 0.6
  const bridgeVertices: number[] = []; const bridgeIndices: number[] = []
  for (let i = 0; i <= 48; i++) { const t = i / 48; bridgeVertices.push(-width / 2, deckY(t), distance * t, width / 2, deckY(t), distance * t); if (i < 48) { const a = i * 2; bridgeIndices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3) } }
  const road = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(bridgeVertices, 3)); road.setIndex(bridgeIndices); road.computeVertexNormals()
  mesh(road, asphalt, bridge)
  for (let i = 0; i < 48; i++) {
    const a = i / 48; const b = (i + 1) / 48
    for (const side of [-1, 1]) {
      beam(new THREE.Vector3(side * width / 2, deckY(a) - 1, distance * a), new THREE.Vector3(side * width / 2, deckY(b) - 1, distance * b), 1.1, concrete, bridge)
      beam(new THREE.Vector3(side * width / 2, deckY(a) + 1.3, distance * a), new THREE.Vector3(side * width / 2, deckY(b) + 1.3, distance * b), 0.13, white, bridge)
    }
    if (i % 2 === 0) beam(new THREE.Vector3(0, deckY(a) + 0.05, distance * a), new THREE.Vector3(0, deckY(b) + 0.05, distance * b), 0.12, white, bridge)
  }
  for (const t of [0.25, 0.75]) {
    const z = t * distance; const top = deckY(t) + 60
    for (const side of [-1, 1]) {
      beam(new THREE.Vector3(side * 9, -2, z), new THREE.Vector3(side * 4.5, top, z), 1.5, white, bridge)
      for (const offset of [-0.21, -0.14, -0.07, 0.07, 0.14, 0.21]) {
        const anchor = t + offset
        beam(new THREE.Vector3(side * 4.5, top - Math.abs(offset) * 28, z), new THREE.Vector3(side * width / 2, deckY(anchor), anchor * distance), 0.12, steel, bridge)
      }
    }
    beam(new THREE.Vector3(-4.5, top - 7, z), new THREE.Vector3(4.5, top - 7, z), 0.8, white, bridge)
  }
  for (let i = 0; i <= 12; i++) {
    const t = i / 12; const position = new THREE.Vector3(width / 2, deckY(t) + 3, t * distance).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw).add(bridge.position)
    mesh(new THREE.SphereGeometry(0.6, 6, 4), lit, nightLights, position.x, position.y, position.z, 0.7)
  }

  // A recognisable 170 m Spinnaker Tower: twin legs, a bowed white sail,
  // stacked glazed observation decks around 100 m and the slender upper spire.
  const tower = new THREE.Group(); tower.name = spinnakerTower.name; city.add(tower)
  tower.position.set(spinnakerTower.x, islandHeight(coastalIslands[0], spinnakerTower.x, spinnakerTower.z), spinnakerTower.z); tower.rotation.y = -0.25
  mesh(new THREE.CylinderGeometry(21, 23, 4, 32), concrete, tower, 0, 1, 0)
  for (const side of [-1, 1]) {
    beam(new THREE.Vector3(-8, 3, side * 7), new THREE.Vector3(-3, 105, side * 3), 2.3, white, tower)
    const sail = new THREE.CatmullRomCurve3([[14, 3], [29, 33], [34, 72], [27, 111], [12, 147], [0, 170]].map(([x, y]) => new THREE.Vector3(x, y, side * 3)))
    mesh(new THREE.TubeGeometry(sail, 64, 1.25, 8, false), white, tower)
    for (const t of [0.17, 0.29, 0.41, 0.53, 0.65, 0.77]) {
      const end = sail.getPoint(t)
      beam(new THREE.Vector3(-5, end.y * 0.78, side * 3), end, 0.5, white, tower)
    }
  }
  beam(new THREE.Vector3(-3, 98, 0), new THREE.Vector3(0, 170, 0), 1, white, tower)
  for (const [i, y] of [100, 105, 110].entries()) {
    const platform = mesh(new THREE.CylinderGeometry(1, 1, 0.9, 40), white, tower, 5, y, 0); platform.scale.set(17 - i * 2, 1, 8 - i)
    const windows = mesh(new THREE.CylinderGeometry(1, 1, 3.8, 40, 1, true), glass, tower, 5, y + 2.3, 0, 0.46); windows.scale.set(16.4 - i * 2, 1, 7.5 - i)
  }
  // Hundreds of bridge cables, railings and tower members become a handful of
  // static draws per feed; facade/body instances remain independently instanced.
  function batch(root: THREE.Group) {
    city.updateMatrixWorld(true)
    const inverse = root.matrixWorld.clone().invert()
    const buckets = new Map<string, { material: THREE.Material; heat: number; objects: THREE.Mesh[]; geometry: THREE.BufferGeometry[] }>()
    root.traverse(object => {
      if (!(object instanceof THREE.Mesh) || object instanceof THREE.InstancedMesh || Array.isArray(object.material)) return
      if (root === city && object.parent === nightLights) return
      const key = `${object.material.uuid}:${object.userData.heat}:${Object.keys(object.geometry.attributes).sort().join(',')}:${Boolean(object.geometry.index)}`
      let bucket = buckets.get(key)
      if (!bucket) { bucket = { material: object.material, heat: object.userData.heat, objects: [], geometry: [] }; buckets.set(key, bucket) }
      bucket.objects.push(object); bucket.geometry.push(object.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, object.matrixWorld)))
    })
    for (const bucket of buckets.values()) {
      const merged = mergeGeometries(bucket.geometry)
      if (merged) {
        const object = new THREE.Mesh(merged, bucket.material); object.userData.heat = bucket.heat; object.name = 'Batched island architecture'; root.add(object)
        for (const source of bucket.objects) { source.removeFromParent(); source.geometry.dispose() }
      }
      for (const geometry of bucket.geometry) geometry.dispose()
    }
  }
  batch(city); batch(nightLights)
  return {
    setNight(night: boolean) { district.setNight(night); white.emissiveIntensity = night ? 0.5 : 0; glass.emissiveIntensity = night ? 0.8 : 0; nightLights.visible = night },
    dispose() { district.dispose() },
  }
}

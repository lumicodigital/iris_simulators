import * as THREE from 'three'
import type { HeatSource } from './thermalView'
import { sampleOceanWaves } from './ocean'
import { createIslandCity } from './islandCity'
import { createSeaTraffic } from './seaTraffic'
import { cargoPose, cargoRoutes, coastalIslands, islandEdge, navigationBuoys, smallBoats, wreckPositions } from '../simulation/maritime'
export { cargoRoutes } from '../simulation/maritime'

export const maritimeLandmarks = [
  { name: 'Container ship Atlas', position: [75, 0, 190] },
  { name: 'Cargo ship Meridian', position: [-160, 0, -310] },
  { name: 'Coastal island', position: [-520, 0, 920] },
  { name: 'Lighthouse island', position: [250, 0, 650] },
  { name: 'Port wreck', position: [52, 0, 30] },
  { name: 'Stern wreck', position: [-85, 0, -95] },
  { name: 'Port buoy', position: [22, 0, 8] },
  { name: 'Starboard buoy', position: [-24, 0, -10] },
] as const

export function createMaritimeWorld(scene: THREE.Scene) {
  const world = new THREE.Group(); world.name = 'Coastal navigation scene'; scene.add(world)
  const heatSources: HeatSource[] = [{ object: world, heat: 0.24 }]
  const white = new THREE.MeshStandardMaterial({ color: 0xe5e5d9, roughness: 0.6 })
  const dark = new THREE.MeshStandardMaterial({ color: 0x233a45, metalness: 0.3, roughness: 0.6 })
  const rust = new THREE.MeshStandardMaterial({ color: 0x80492f, metalness: 0.2, roughness: 0.95 })
  const steel = new THREE.MeshStandardMaterial({ color: 0x596c71, metalness: 0.65, roughness: 0.5 })
  const glass = new THREE.MeshStandardMaterial({ color: 0x174452, roughness: 0.28, emissive: 0xffc77c, emissiveIntensity: 0 })
  const timber = new THREE.MeshStandardMaterial({ color: 0x7f6a4c, roughness: 0.95 })
  const glows = new THREE.Group(); glows.name = 'Navigation lights'; glows.visible = false; world.add(glows)
  const floating: { object: THREE.Group; y: number }[] = []
  const cargoShips: THREE.Group[] = []
  function mesh(geometry: THREE.BufferGeometry, material: THREE.Material, parent: THREE.Object3D, x = 0, y = 0, z = 0, heat = 0.25) {
    const item = new THREE.Mesh(geometry, material); item.position.set(x, y, z)
    item.userData.heat = heat; parent.add(item); return item
  }
  function box(w: number, h: number, d: number, material: THREE.Material, parent: THREE.Object3D, x = 0, y = 0, z = 0, heat = 0.25) {
    return mesh(new THREE.BoxGeometry(w, h, d), material, parent, x, y, z, heat)
  }
  function pole(a: THREE.Vector3, b: THREE.Vector3, radius: number, parent: THREE.Object3D, material: THREE.Material = steel) {
    const difference = b.clone().sub(a)
    const item = mesh(new THREE.CylinderGeometry(radius, radius, difference.length(), 6), material, parent)
    item.position.copy(a).add(b).multiplyScalar(0.5)
    item.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), difference.normalize()); return item
  }
  function beacon(parent: THREE.Object3D, x: number, y: number, z: number, color: number, radius = 0.22) {
    const material = new THREE.MeshBasicMaterial({ color, toneMapped: false })
    const light = mesh(new THREE.SphereGeometry(radius, 8, 6), material, parent, x, y, z, 0.65)
    const halo = mesh(new THREE.SphereGeometry(radius * 2.7, 8, 6), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.16, depthWrite: false, toneMapped: false }), glows)
    return { light, halo }
  }
  const beacons: { light: THREE.Mesh; halo: THREE.Mesh }[] = []
  function hull(parent: THREE.Object3D, length: number, beam: number, height: number, material: THREE.Material) {
    const shape = new THREE.Shape()
    shape.moveTo(-beam / 2, -length / 2); shape.lineTo(beam / 2, -length / 2)
    shape.lineTo(beam / 2, length * 0.27); shape.quadraticCurveTo(beam * 0.4, length * 0.44, 0, length / 2)
    shape.quadraticCurveTo(-beam * 0.4, length * 0.44, -beam / 2, length * 0.27); shape.closePath()
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: true, bevelSegments: 1, bevelSize: beam * 0.08, bevelThickness: beam * 0.08, steps: 1, curveSegments: 8 })
    geometry.rotateX(Math.PI / 2); geometry.translate(0, height, 0)
    const body = mesh(geometry, material, parent, 0, -height * 0.35, 0)
    return body
  }
  function island(x: number, z: number, rx: number, rz: number, height: number, name: string) {
    const terrain = new THREE.Group(); terrain.name = name; terrain.position.set(x, 0, z); world.add(terrain)
    const vertices: number[] = []; const colors: number[] = []; const indices: number[] = []
    const rings = 12; const sectors = 64
    for (let ring = 0; ring <= rings; ring++) for (let sector = 0; sector <= sectors; sector++) {
      const r = ring / rings; const angle = sector / sectors * Math.PI * 2
      const edge = islandEdge(angle)
      const px = Math.cos(angle) * rx * r * edge; const pz = Math.sin(angle) * rz * r * edge
      const peak = Math.max(0, 1 - r ** 1.4) * (0.7 + 0.2 * Math.sin(px * 0.025) + 0.13 * Math.cos(pz * 0.04))
      const y = r > 0.93 ? -1 + (1 - r) * 25 : 1.5 + height * peak
      vertices.push(px, y, pz)
      const color = new THREE.Color(r > 0.83 ? 0xb2a482 : y > height * 0.66 ? 0x798377 : 0x46745c)
      color.multiplyScalar(0.9 + 0.1 * Math.sin(angle * 9 + ring)); colors.push(color.r, color.g, color.b)
      if (ring < rings && sector < sectors) { const a = ring * (sectors + 1) + sector; const b = a + sectors + 1; indices.push(a, a + 1, b, a + 1, b + 1, b) }
    }
    const geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3)).setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
    geometry.setIndex(indices); geometry.computeVertexNormals()
    mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide }), terrain, 0, 0, 0, 0.18)
    return terrain
  }
  const islands = coastalIslands.map(item => island(item.x, item.z, item.rx, item.rz, item.height, item.name))
  const city = createIslandCity(world)
  const traffic = createSeaTraffic(world)
  const lighthouseIsland = islands[3]
  mesh(new THREE.CylinderGeometry(2.1, 3.3, 16, 12), white, lighthouseIsland, 8, 24, 2)
  mesh(new THREE.CylinderGeometry(2.2, 2.5, 3, 12), rust, lighthouseIsland, 8, 27, 2)
  mesh(new THREE.CylinderGeometry(3, 3, 0.5, 12), dark, lighthouseIsland, 8, 32.5, 2)
  mesh(new THREE.ConeGeometry(3.3, 2, 12), rust, lighthouseIsland, 8, 36, 2)
  beacons.push(beacon(lighthouseIsland, 8, 34, 2, 0xffe2a4, 1.1))

  function cargo(x: number, z: number, yaw: number, name: string, color: number) {
    const ship = new THREE.Group(); ship.name = name; ship.position.set(x, 0, z); ship.rotation.y = yaw; world.add(ship)
    ship.userData.thermalAnimated = true; cargoShips.push(ship)
    hull(ship, 105, 18, 9, new THREE.MeshStandardMaterial({ color, roughness: 0.67, metalness: 0.35 }))
    box(17, 0.6, 83, dark, ship, 0, 6.3, 0)
    box(15, 13, 13, white, ship, 0, 12.4, -32, 0.46)
    box(16, 3, 14, white, ship, 0, 19.5, -32)
    for (const side of [-1, 1]) box(0.1, 1.4, 11.5, glass, ship, side * 8.05, 19.7, -32, 0.5)
    box(3, 10, 4, dark, ship, 3, 21, -36, 0.86)
    const containerColors = [0x9e4e3f, 0x3c7982, 0xbd9853, 0x637f4b, 0x315c7c]
    const containers = new THREE.InstancedMesh(new THREE.BoxGeometry(4.8, 3.5, 9.8), new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0.2 }), 45)
    containers.name = 'Cargo containers'; containers.userData.heat = 0.28; ship.add(containers)
    const matrix = new THREE.Matrix4(); const paint = new THREE.Color(); let instance = 0
    for (let row = 0; row < 6; row++) for (let column = 0; column < 3; column++) for (let tier = 0; tier < 2 + (row % 2); tier++) {
      containers.setMatrixAt(instance, matrix.makeTranslation((column - 1) * 5.2, 8.4 + tier * 3.7, -17 + row * 10.5))
      containers.setColorAt(instance++, paint.set(containerColors[(row + column + tier) % containerColors.length]))
    }
    containers.computeBoundingSphere()
    pole(new THREE.Vector3(0, 19, -32), new THREE.Vector3(0, 29, -32), 0.15, ship)
    beacons.push(beacon(ship, 8.8, 18.8, -28, 0xff3c32, 0.38), beacon(ship, -8.8, 18.8, -28, 0x4bff9a, 0.38), beacon(ship, 0, 29, -32, 0xffe7bc, 0.4))
  }
  cargo(75, 190, -0.45, 'Container ship Atlas', 0x3e5264)
  cargo(-160, -310, 1.7, 'Cargo ship Meridian', 0x8e4636)
  function smallBoat(x: number, z: number, yaw: number, sail: boolean, name: string) {
    const boat = new THREE.Group(); boat.name = name; boat.position.set(x, 0, z); boat.rotation.y = yaw; world.add(boat)
    hull(boat, sail ? 12 : 10, 3.5, 1.7, white)
    box(2.3, 1.6, 4, dark, boat, 0, 1.6, -1)
    box(2.5, 0.3, 4.4, white, boat, 0, 2.5, -1)
    if (sail) {
      pole(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 17, 0), 0.09, boat)
      const sailShape = new THREE.Shape(); sailShape.moveTo(0, 0); sailShape.lineTo(0, 14); sailShape.lineTo(6, 0); sailShape.closePath()
      const canvas = mesh(new THREE.ShapeGeometry(sailShape), new THREE.MeshStandardMaterial({ color: 0xefe9d6, side: THREE.DoubleSide, roughness: 1 }), boat, 0.08, 2, 0)
      canvas.rotation.y = Math.PI / 2
    }
    beacons.push(beacon(boat, 1.6, 2, 0, 0xff4938, 0.13), beacon(boat, -1.6, 2, 0, 0x4bffa0, 0.13))
    boat.userData.thermalAnimated = true
    floating.push({ object: boat, y: 0 })
  }
  for (const boat of smallBoats) smallBoat(boat.x, boat.z, boat.yaw, boat.sail, boat.name)

  for (const [x, z, color] of navigationBuoys) {
    const buoy = new THREE.Group(); buoy.name = 'Navigation buoy'; buoy.position.set(x, 0, z); world.add(buoy)
    const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.55 })
    mesh(new THREE.CylinderGeometry(0.7, 1.05, 0.65, 12), paint, buoy, 0, 0.2)
    mesh(new THREE.ConeGeometry(0.48, 1.4, 10), paint, buoy, 0, 1.1)
    pole(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 3.8, 0), 0.08, buoy, paint)
    mesh(new THREE.ConeGeometry(0.3, 0.55, 8), paint, buoy, 0, 3.6)
    beacons.push(beacon(buoy, 0, 4, 0, color, 0.16))
    buoy.userData.thermalAnimated = true
    floating.push({ object: buoy, y: 0 })
  }
  for (const [x, z, length, yaw, roll] of wreckPositions) {
    const wreck = new THREE.Group(); wreck.name = 'Partially submerged shipwreck'; wreck.position.set(x, -2, z); wreck.rotation.set(0.08, yaw, roll); world.add(wreck)
    hull(wreck, length, length * 0.26, 4, rust)
    for (let rib = -length * 0.35; rib < length * 0.4; rib += 2) {
      pole(new THREE.Vector3(-length * 0.1, 2.5, rib), new THREE.Vector3(-length * 0.1, 5, rib), 0.12, wreck, rust)
      pole(new THREE.Vector3(length * 0.1, 2.5, rib), new THREE.Vector3(length * 0.1, 5, rib), 0.12, wreck, rust)
      pole(new THREE.Vector3(-length * 0.1, 4.5, rib), new THREE.Vector3(length * 0.1, 4.5, rib), 0.09, wreck, rust)
    }
    box(length * 0.2, 4, length * 0.22, rust, wreck, 0, 4.7, -length * 0.29)
    box(length * 0.21, 0.8, length * 0.16, dark, wreck, 0, 5.1, -length * 0.29)
    pole(new THREE.Vector3(0, 5, -length * 0.3), new THREE.Vector3(1.7, 12, -length * 0.23), 0.12, wreck, rust)
  }
  // A small harbour on the near coast provides structures and harbour lights.
  const harbour = new THREE.Group(); harbour.name = 'Island marina'; harbour.position.set(-320, 0, 650); world.add(harbour)
  box(7, 1.5, 100, timber, harbour, 0, 0.8, 0)
  for (const z of [-35, -10, 15, 40]) {
    box(38, 0.7, 3.5, timber, harbour, 0, 1.2, z)
    for (const side of [-1, 1]) { box(0.6, 4, 0.6, timber, harbour, side * 17, 1.5, z); beacons.push(beacon(harbour, side * 17, 3.6, z, 0xffd39a, 0.2)) }
  }
  for (let i = 0; i < 6; i++) {
    box(12, 7 + i % 3 * 2, 14, white, harbour, -36 - (i % 3) * 19, 5 + i % 3, -25 + Math.floor(i / 3) * 28)
    box(10, 2, 0.15, glass, harbour, -36 - (i % 3) * 19, 5, -17.9 + Math.floor(i / 3) * 28, 0.45)
  }
  let night = false
  return {
    heatSources,
    setNight(value: boolean) { night = value; glows.visible = value; glass.emissiveIntensity = value ? 0.7 : 0; city.setNight(value); traffic.setNight(value) },
    dispose() { city.dispose() },
    update(seconds: number, strength = 1) {
      traffic.update(seconds, strength)
      // All rendered feeds share time, rather than accumulating their own motion.
      for (const [i, ship] of cargoShips.entries()) {
        const route = cargoRoutes[i]
        const pose = cargoPose(route, seconds)
        ship.position.x = pose.x; ship.position.z = pose.z
        ship.position.y = sampleOceanWaves(ship.position.x, ship.position.z, seconds, strength).height * 0.18
        // Point the bow along the route's tangent, including counterclockwise traffic.
        ship.rotation.y = pose.yaw
      }
      for (const item of floating) {
        const wave = sampleOceanWaves(item.object.position.x, item.object.position.z, seconds, strength)
        const yaw = item.object.rotation.y
        item.object.position.y = item.y + wave.height * 0.8
        item.object.rotation.x = -Math.atan(wave.dx * Math.sin(yaw) + wave.dz * Math.cos(yaw)) * 0.65
        item.object.rotation.z = Math.atan(wave.dx * Math.cos(yaw) - wave.dz * Math.sin(yaw)) * 0.65
      }
      world.updateMatrixWorld(true)
      for (let i = 0; i < beacons.length; i++) {
        const beacon = beacons[i]; beacon.light.getWorldPosition(beacon.halo.position)
        beacon.halo.visible = night && (i < 10 || Math.sin(seconds * 1.8 + i) > -0.3)
      }
    },
  }
}

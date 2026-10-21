import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import type { HeatSource } from './thermalView'
import { createMaritimeWorld } from './maritimeWorld'
import { createOcean, sampleOceanWaves } from './ocean'
import { yachtMotion } from './vesselMotion'
import { createShipWakes } from './shipWakes'
import { tenderPosition, yachtPose } from '../simulation/maritime'

// A procedural 50 m motor yacht. Exterior and machinery share real world space,
// so every CCTV feed sees the boat from its own installation point.
export function createYacht(scene: THREE.Scene, reflectionSize = 256) {
  const yacht = new THREE.Group(); yacht.name = 'IRIS Explorer · 50 m yacht'; scene.add(yacht)
  yacht.userData.thermalAnimated = true
  const exterior = new THREE.Group(); yacht.add(exterior)
  const white = new THREE.MeshStandardMaterial({ color: 0xf1f1e8, metalness: 0.15, roughness: 0.32 })
  const hullPaint = new THREE.MeshStandardMaterial({ color: 0xe4eaf0, metalness: 0.28, roughness: 0.3, side: THREE.DoubleSide })
  const navy = new THREE.MeshStandardMaterial({ color: 0x122d40, roughness: 0.27, metalness: 0.4 })
  const glass = new THREE.MeshStandardMaterial({ color: 0x174453, metalness: 0.6, roughness: 0.13 })
  glass.emissive.set(0xffcd8c)
  const teak = new THREE.MeshStandardMaterial({ color: 0xb68c60, roughness: 0.84 })
  const silver = new THREE.MeshStandardMaterial({ color: 0xc0cdd2, metalness: 0.85, roughness: 0.24 })
  const upholstery = new THREE.MeshStandardMaterial({ color: 0xe2d7bd, roughness: 0.95 })
  const machinery = new THREE.MeshStandardMaterial({ color: 0x356776, roughness: 0.55, metalness: 0.5 })
  const hotMetal = new THREE.MeshStandardMaterial({ color: 0x83969c, roughness: 0.55, metalness: 0.5 })
  const pipeRed = new THREE.MeshStandardMaterial({ color: 0xab5944, roughness: 0.5, metalness: 0.35 })
  const pipeBlue = new THREE.MeshStandardMaterial({ color: 0x3c8394, roughness: 0.5, metalness: 0.4 })
  function mesh(geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = exterior, heat = 0.26) {
    const object = new THREE.Mesh(geometry, material)
    object.position.set(x, y, z); object.castShadow = true; object.receiveShadow = true
    object.userData.heat = heat; parent.add(object); return object
  }
  function box(w: number, h: number, d: number, x: number, y: number, z: number, material: THREE.Material = white, parent: THREE.Object3D = exterior, heat = 0.26, radius = 0.08) {
    return mesh(new RoundedBoxGeometry(w, h, d, 2, Math.min(radius, w / 3, h / 3, d / 3)), material, x, y, z, parent, heat)
  }
  function pipe(a: THREE.Vector3, b: THREE.Vector3, radius: number, material: THREE.Material, parent = exterior, heat = 0.3) {
    const delta = b.clone().sub(a)
    const object = mesh(new THREE.CylinderGeometry(radius, radius, delta.length(), 10), material, ...a.clone().add(b).multiplyScalar(0.5).toArray() as [number, number, number], parent, heat)
    object.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize()); return object
  }
  function deck(width: number, length: number, y: number, z: number) {
    box(width, 0.28, length, 0, y, z, white, exterior, 0.28, 0.13)
    box(width - 0.35, 0.055, length - 0.35, 0, y + 0.17, z, teak)
    const planks: number[] = []
    for (let x = -width / 2 + 0.4; x < width / 2 - 0.3; x += 0.32) planks.push(x, y + 0.203, z - length / 2 + 0.3, x, y + 0.203, z + length / 2 - 0.3)
    const geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(planks, 3))
    exterior.add(new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: 0x775b42, transparent: true, opacity: 0.6 })))
    const rail: number[] = []
    const corners = [[-width / 2 + 0.15, z - length / 2 + 0.2], [width / 2 - 0.15, z - length / 2 + 0.2], [width / 2 - 0.15, z + length / 2 - 0.2], [-width / 2 + 0.15, z + length / 2 - 0.2]]
    corners.forEach(([x, zz], i) => {
      const [nx, nz] = corners[(i + 1) % corners.length]
      rail.push(x, y + 1.05, zz, nx, y + 1.05, nz, x, y + 0.66, zz, nx, y + 0.66, nz)
      const posts = Math.ceil(Math.hypot(nx - x, nz - zz) / 1.7)
      for (let j = 0; j < posts; j++) { const px = x + (nx - x) * j / posts; const pz = zz + (nz - zz) * j / posts; rail.push(px, y + 0.2, pz, px, y + 1.05, pz) }
    })
    exterior.add(new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(rail, 3)), new THREE.LineBasicMaterial({ color: 0xd3e3e8 })))
  }

  const sections = [[-23, 4.1, -1.3], [-20, 5.6, -2.3], [-12, 5.9, -2.7], [2, 5.9, -2.5], [12, 4.9, -1.8], [20, 2.8, -0.5], [25, 0.05, 1.2]]
  const vertices: number[] = []; const indices: number[] = []
  sections.forEach(([z, width, keel], i) => {
    const ring = [[0, keel], [width * 0.68, keel + 0.3], [width * 0.96, 0.3], [width, 2.9], [-width, 2.9], [-width * 0.96, 0.3], [-width * 0.68, keel + 0.3]]
    ring.forEach(([x, y]) => vertices.push(x, y, z))
    if (i) for (let j = 0; j < ring.length; j++) {
      const a = (i - 1) * ring.length + j; const b = (i - 1) * ring.length + (j + 1) % ring.length; const c = i * ring.length + j; const d = i * ring.length + (j + 1) % ring.length
      indices.push(a, c, b, b, c, d)
    }
  })
  const hullGeometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
  hullGeometry.setIndex(indices); hullGeometry.computeVertexNormals()
  mesh(hullGeometry, hullPaint, 0, 0, 0)
  const outline = new THREE.LineSegments(new THREE.EdgesGeometry(hullGeometry, 28), new THREE.LineBasicMaterial({ color: 0x7bc5d0, transparent: true, opacity: 0.28 }))
  outline.visible = false; yacht.add(outline)
  box(8.2, 2.8, 0.15, 0, 1.45, -23, white)
  const bow = new THREE.Shape(); bow.moveTo(-5.5, -9)
  bow.lineTo(5.5, -9); bow.lineTo(4.8, -13); bow.quadraticCurveTo(2.9, -22, 0, -24.7); bow.quadraticCurveTo(-2.9, -22, -4.8, -13); bow.closePath()
  const bowDeck = mesh(new THREE.ShapeGeometry(bow, 24), teak, 0, 3, 0); bowDeck.rotation.x = -Math.PI / 2
  deck(11.25, 34, 2.95, -4.5)
  deck(9.8, 29, 5.7, -2)
  deck(7.8, 19, 8.35, -1)
  box(8.6, 2.25, 22, 0, 4.28, 0.5, white, exterior, 0.31, 0.28)
  box(7.1, 2.12, 14, 0, 6.95, 0.5, white, exterior, 0.32, 0.28)
  for (const side of [-1, 1]) {
    for (let z = -8; z <= 8; z += 3) box(0.08, 1.3, 2.65, side * 4.32, 4.45, z, glass)
    box(0.09, 1.25, 11.7, side * 3.58, 7.06, 0.9, glass)
    for (let z = -18; z < 15; z += 3.2) box(0.08, 0.55, 1.45, side * (z > 10 ? 4.9 : 5.7), 1.4, z, navy)
    box(0.25, 0.18, 18, side * 5.7, 0.1, -5, navy)
  }
  const windshield = box(6.9, 1.35, 0.12, 0, 7.08, 7.55, glass); windshield.rotation.x = -0.15
  for (let x = -2.6; x <= 2.7; x += 1.3) box(0.07, 1.5, 0.18, x, 7.1, 7.57, white)
  box(7.4, 0.25, 1.6, 0, 8.25, 8, white)

  // Swim platform, stepped transom, pool, outdoor seating and foredeck helipad.
  for (let i = 0; i < 5; i++) box(8.1, 0.22, 1.6, 0, 0.65 + i * 0.47, -25.5 + i * 0.65, teak)
  box(4.5, 0.18, 5.4, 0, 3.17, -17.3, white)
  box(4.1, 0.06, 5, 0, 3.28, -17.3, new THREE.MeshStandardMaterial({ color: 0x319ba9, metalness: 0.4, roughness: 0.2 }), exterior, 0.12)
  for (const x of [-3.9, 3.9]) for (const z of [-14.8, -18]) {
    box(1.15, 0.3, 2.6, x, 3.45, z, upholstery)
    const back = box(1.15, 0.13, 0.9, x, 3.8, z - 0.9, upholstery); back.rotation.x = -0.42
  }
  for (const x of [-2.5, 2.5]) {
    box(1.4, 0.45, 5.6, x, 6.17, -12, upholstery)
    box(0.3, 0.75, 5.6, x + Math.sign(x) * 0.65, 6.38, -12, white)
  }
  box(1.8, 0.17, 2.7, 0, 6.28, -11.8, teak)
  box(2.6, 0.4, 3.8, 0, 8.84, -4.2, upholstery)
  const helipad = mesh(new THREE.CircleGeometry(3.1, 64), new THREE.MeshStandardMaterial({ color: 0x608f8b, roughness: 0.8 }), 0, 3.04, 15)
  helipad.rotation.x = -Math.PI / 2
  const helipadRing = mesh(new THREE.RingGeometry(2.65, 2.72, 64), white, 0, 3.055, 15); helipadRing.rotation.x = -Math.PI / 2
  box(0.18, 0.02, 1.7, -0.6, 3.07, 15, white); box(0.18, 0.02, 1.7, 0.6, 3.07, 15, white); box(1.2, 0.02, 0.18, 0, 3.07, 15, white)
  box(0.35, 2.4, 0.5, 0, 9.7, -0.6, white)
  box(5.7, 0.2, 0.45, 0, 10.3, -0.6, white)
  pipe(new THREE.Vector3(0, 10, -0.6), new THREE.Vector3(0, 12.2, -0.6), 0.055, silver)
  box(0.7, 0.1, 0.7, 0, 12.25, -0.6, white)
  for (const side of [-1, 1]) {
    mesh(new THREE.SphereGeometry(0.65, 20, 12), white, side * 2, 9.15, -0.6)
    pipe(new THREE.Vector3(side * 2.8, 8.55, 2), new THREE.Vector3(side * 2.8, 11.8, 2), 0.035, silver)
  }

  // Lower-deck machinery remains visible when the exterior is cut away.
  const room = new THREE.Group(); room.name = 'Boiler room'; yacht.add(room)
  box(9.1, 0.2, 10, 0, -1.8, -6, navy, room, 0.16)
  box(0.18, 4, 10, -4.5, 0.2, -6, white, room, 0.2)
  box(9.1, 4, 0.18, 0, 0.2, -10.9, white, room, 0.2)
  box(9.1, 4, 0.18, 0, 0.2, -1.1, white, room, 0.2)
  box(0.18, 4, 10, 4.5, 0.2, -6, white, exterior, 0.2)
  box(9.1, 0.15, 10, 0, 2.25, -6, navy, exterior, 0.2)
  for (const x of [-2.4, 0.3]) {
    mesh(new THREE.CylinderGeometry(0.85, 0.85, 2.35, 24), hotMetal, x, -0.35, -5.2, room, 0.88)
    box(2, 0.15, 2.1, x, -1.6, -5.2, navy, room, 0.35)
    const band = mesh(new THREE.TorusGeometry(0.87, 0.045, 8, 24), navy, x, -0.1, -5.2, room, 0.7); band.rotation.x = Math.PI / 2
    pipe(new THREE.Vector3(x, 0.9, -5.2), new THREE.Vector3(x, 1.65, -5.2), 0.16, pipeRed, room, 0.79)
    pipe(new THREE.Vector3(x, 1.65, -5.2), new THREE.Vector3(x, 1.65, -9.8), 0.16, pipeRed, room, 0.72)
    box(1.35, 1.5, 2.1, x, -0.85, -8.5, machinery, room, 0.68)
    for (let z = -9.2; z <= -7.8; z += 0.28) box(1.5, 0.07, 0.1, x, -0.08, z, silver, room, 0.71)
  }
  for (let i = 0; i < 3; i++) pipe(new THREE.Vector3(-4.25, 1 + i * 0.35, -10), new THREE.Vector3(-4.25, 1 + i * 0.35, -1.5), 0.09, i === 2 ? pipeRed : pipeBlue, room, i === 2 ? 0.65 : 0.38)
  box(2.1, 2.2, 0.22, 2.5, -0.1, -1.3, machinery, room, 0.42)
  for (let i = 0; i < 4; i++) {
    box(0.35, 0.3, 0.04, 1.8 + i * 0.45, 0.5, -1.16, glass, room, 0.48)
    mesh(new THREE.SphereGeometry(0.045, 6, 6), new THREE.MeshBasicMaterial({ color: i === 3 ? 0xffb84d : 0x6bdeb1 }), 1.8 + i * 0.45, -0.15, -1.13, room, 0.55)
  }
  box(0.4, 0.7, 0.4, 3.7, -1.35, -7.8, silver, room, 0.25)
  const roomLight = new THREE.PointLight(0xf4e3b7, 20, 15, 1.5); roomLight.position.set(0, 1.7, -6); yacht.add(roomLight)
  box(3, 0.06, 0.18, 0, 2.02, -6, new THREE.MeshBasicMaterial({ color: 0xffedbc }), room, 0.95)

  const ocean = createOcean(scene, reflectionSize)
  const wakes = createShipWakes(scene)
  // A nearby tender gives exterior feeds a useful reference beyond the railings.
  const tender = new THREE.Group(); tender.name = 'Yacht tender'; tender.userData.thermalAnimated = true; tender.position.set(tenderPosition.x, 0, tenderPosition.z); scene.add(tender)
  box(2.6, 0.8, 6.5, 0, 0.3, 0, white, tender)
  box(1.4, 0.9, 1.8, 0, 1, 0.5, navy, tender)
  box(1.7, 0.2, 2.2, 0, 0.85, -1.8, upholstery, tender)
  const surroundings = createMaritimeWorld(scene)
  const heatSources: HeatSource[] = [{ object: yacht, heat: 0.27 }, { object: ocean.object, heat: 0.08 }, { object: tender, heat: 0.3 }, ...surroundings.heatSources]
  return {
    vessel: yacht,
    heatSources,
    setNight(night: boolean) {
      ocean.setNight(night)
      glass.emissiveIntensity = night ? 0.18 : 0
      surroundings.setNight(night)
      wakes.setNight(night)
    },
    update(seconds: number, strength = 1) {
      const pose = yachtPose(seconds)
      const motion = yachtMotion(seconds, strength, pose.x, pose.z, pose.yaw)
      yacht.position.set(pose.x, motion.heave, pose.z); yacht.rotation.set(motion.pitch, pose.yaw, motion.roll, 'YXZ')
      ocean.update(seconds, strength, pose); tender.position.y = sampleOceanWaves(tenderPosition.x, tenderPosition.z, seconds, strength).height * 0.6
      surroundings.update(seconds, strength); wakes.update(seconds, strength)
    },
    cutaway(enabled: boolean) { exterior.visible = !enabled; outline.visible = enabled },
    dispose() { ocean.dispose(); surroundings.dispose() },
  }
}

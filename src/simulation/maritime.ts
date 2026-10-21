import { CatmullRomCurve3, Vector3 } from 'three'

// World north is +Z and east is -X. Every feed and the chart share these metres.
export const cargoRoutes = [
  { name: 'Container ship Atlas', radiusX: 240, radiusZ: 200, start: Math.atan2(75 / 240, 190 / 200), rate: 0.006 },
  { name: 'Cargo ship Meridian', radiusX: 385, radiusZ: 340, start: Math.atan2(-160 / 385, -310 / 340), rate: -0.0045 },
] as const
export function cargoPose(route: typeof cargoRoutes[number], seconds: number) {
  const angle = route.start + seconds * route.rate
  const vx = Math.cos(angle) * route.radiusX * route.rate; const vz = -Math.sin(angle) * route.radiusZ * route.rate
  return { x: Math.sin(angle) * route.radiusX, z: Math.cos(angle) * route.radiusZ, yaw: Math.atan2(vx, vz), speed: Math.hypot(vx, vz) }
}
export const coastalIslands = [
  { x: -520, z: 920, rx: 640, rz: 270, height: 135, name: 'Coastal island' },
  { x: -1120, z: -360, rx: 470, rz: 520, height: 165, name: 'Western headland' },
  { x: 1150, z: -650, rx: 500, rz: 360, height: 100, name: 'Southern island' },
  { x: 250, z: 650, rx: 105, rz: 75, height: 24, name: 'Lighthouse island' },
] as const
export function islandEdge(angle: number) { return 1 + 0.1 * Math.sin(angle * 5) + 0.05 * Math.sin(angle * 11) }
export type CoastalIsland = typeof coastalIslands[number]
export function islandHeight(island: CoastalIsland, x: number, z: number) {
  const px = x - island.x; const pz = z - island.z
  const r = Math.hypot(px / island.rx, pz / island.rz) / islandEdge(Math.atan2(pz / island.rz, px / island.rx))
  if (r > 1) return -1
  const peak = Math.max(0, 1 - r ** 1.4) * (0.7 + 0.2 * Math.sin(px * 0.025) + 0.13 * Math.cos(pz * 0.04))
  return r > 0.93 ? -1 + (1 - r) * 25 : 1.5 + island.height * peak
}
export const islandBridge = { from: { x: -130, z: 810 }, to: { x: 210, z: 670 }, deckHeight: 45, width: 14 }
export const spinnakerTower = { x: -210, z: 795, height: 170, name: 'Spinnaker Tower' }

// A dedicated outer cruising lane never crosses the cargo lanes in the inner
// basin. The full smoothed curve is clearance-checked against the irregular
// coastlines, bridge and every vessel's swept envelope, rather than waypoints alone.
const yachtCourse = new CatmullRomCurve3([
  [750, 550], [650, 1050], [100, 1450], [-850, 1500], [-1550, 1100],
  [-1950, 300], [-1950, -750], [-1300, -1250], [-500, -1350],
  [500, -1450], [1550, -1350], [1950, -800], [1950, 100], [1300, 350],
].map(([x, z]) => new Vector3(x, 0, z)), true, 'centripetal')
yachtCourse.arcLengthDivisions = 32768
export const yachtCruise = { speed: 7, length: yachtCourse.getLength(), hullRadius: 28 }
export const yachtCruiseDuration = yachtCruise.length / yachtCruise.speed
const routePoint = new Vector3(); const routeTangent = new Vector3(); const routeBehind = new Vector3()
export function yachtPose(seconds: number) {
  const phase = ((seconds % yachtCruiseDuration) + yachtCruiseDuration) % yachtCruiseDuration / yachtCruiseDuration
  yachtCourse.getPointAt(phase, routePoint)
  const step = 0.5 / yachtCruise.length
  // Wrap both samples at the seam: Three's default tangent clamps there and
  // would give the bow a small heading kick on each completed lap.
  yachtCourse.getPointAt((phase + step) % 1, routeTangent)
  yachtCourse.getPointAt((phase - step + 1) % 1, routeBehind); routeTangent.sub(routeBehind)
  return { x: routePoint.x, z: routePoint.z, yaw: Math.atan2(routeTangent.x, routeTangent.z), speed: yachtCruise.speed }
}

export type VesselType = 'sail' | 'fishing' | 'motor' | 'patrol' | 'tug' | 'ferry' | 'container' | 'tanker'
export interface TrafficVessel {
  name: string; type: VesselType; lane: number; phase: number; speed: number
  length: number; beam: number; color: number
}
interface CruiseLane { points: { x: number; z: number; yaw: number }[]; distances: Float64Array; length: number }
const cruiseLanes = new Map<number, CruiseLane>()
export function cruiseLane(offset: number): CruiseLane {
  const cached = cruiseLanes.get(offset)
  if (cached) return cached
  const points = Array.from({ length: 4097 }, (_, i) => {
    const pose = yachtPose(i / 4096 * yachtCruiseDuration)
    // Dilate outer lanes about the open-water basin: a simple normal offset
    // would pinch the two shipping lanes together at the tour's inward bend.
    if (offset >= 0) { const scale = 1 + offset * 1.7 / 900; return { x: pose.x * scale, z: pose.z * scale, yaw: pose.yaw } }
    return { x: pose.x + Math.cos(pose.yaw) * offset, z: pose.z - Math.sin(pose.yaw) * offset, yaw: pose.yaw }
  })
  const distances = new Float64Array(points.length)
  for (let i = 1; i < points.length; i++) distances[i] = distances[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z)
  const lane = { points, distances, length: distances[distances.length - 1] }; cruiseLanes.set(offset, lane); return lane
}
export function trafficPose(vessel: TrafficVessel, seconds: number) {
  const lane = cruiseLane(vessel.lane)
  const distance = ((vessel.phase + seconds * vessel.speed) % lane.length + lane.length) % lane.length
  let lo = 0; let hi = lane.points.length - 1
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (lane.distances[mid] <= distance) lo = mid; else hi = mid }
  const a = lane.points[lo]; const b = lane.points[hi]
  const t = (distance - lane.distances[lo]) / (lane.distances[hi] - lane.distances[lo])
  const turn = Math.atan2(Math.sin(b.yaw - a.yaw), Math.cos(b.yaw - a.yaw))
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, yaw: a.yaw + turn * t, speed: vessel.speed }
}
export const trafficFleet: TrafficVessel[] = [
  ...Array.from({ length: 16 }, (_, i) => ({
    name: `${i % 3 === 0 ? 'Trawler' : 'Sailing yacht'} ${['Aurora', 'Solent', 'Kestrel', 'Orion', 'Calypso', 'Nautilus', 'Marlin', 'Zephyr'][i % 8]} ${Math.floor(i / 8) + 1}`,
    type: (i % 3 === 0 ? 'fishing' : 'sail') as VesselType, lane: -130,
    phase: i / 16 * cruiseLane(-130).length + 125, speed: 3.5,
    length: i % 3 === 0 ? 20 : 13 + i % 4 * 2, beam: i % 3 === 0 ? 6 : 4.5,
    color: [0x378e9e, 0xcbbba0, 0x436681, 0xb66443][i % 4],
  })),
  ...Array.from({ length: 18 }, (_, i) => ({
    name: `${['Motor yacht', 'Harbour tug', 'Patrol launch'][i % 3]} ${String(i + 1).padStart(2, '0')}`,
    type: (['motor', 'tug', 'patrol'] as const)[i % 3], lane: 100,
    phase: i / 18 * cruiseLane(100).length - 100, speed: 8,
    length: [29 + i % 4 * 4, 22, 17][i % 3], beam: [8, 8.5, 5][i % 3],
    color: [0xe2e7e1, 0xb74937, 0x276a90, 0xd2b16e, 0x4d7379, 0x858eab][i % 6],
  })),
  ...Array.from({ length: 5 }, (_, i) => ({
    name: `${i % 2 ? 'Island ferry' : 'Container ship'} ${['Endeavour', 'Liberty', 'Horizon', 'Discovery', 'Pacific'][i]}`,
    type: (i % 2 ? 'ferry' : 'container') as VesselType, lane: 235,
    phase: i / 5 * cruiseLane(235).length + 260, speed: 5.2,
    length: i % 2 ? 62 : 105, beam: i % 2 ? 16 : 20, color: i % 2 ? 0xe1e4db : 0x3b687c,
  })),
  ...Array.from({ length: 4 }, (_, i) => ({
    name: `${i % 2 ? 'Cargo ship' : 'Product tanker'} ${['Odyssey', 'Northern Star', 'Proteus', 'Ocean Trader'][i]}`,
    type: (i % 2 ? 'container' : 'tanker') as VesselType, lane: 425,
    phase: i / 4 * cruiseLane(425).length - 390, speed: 4.8,
    length: i % 2 ? 115 : 130, beam: 23, color: i % 2 ? 0x814d43 : 0x43757b,
  })),
]
export const vesselRadius = (vessel: TrafficVessel) => Math.hypot(vessel.length * 0.55, vessel.beam * 0.8) + 3
export const cruiseBuoys = Array.from({ length: 48 }, (_, i) => [-1, 1].map(side => {
  const pose = yachtPose(i / 48 * yachtCruiseDuration); const offset = side * 52
  return { name: `Cruise channel ${side < 0 ? 'red' : 'green'} ${i + 1}`, x: pose.x + Math.cos(pose.yaw) * offset, z: pose.z - Math.sin(pose.yaw) * offset, color: side < 0 ? 0xe3543d : 0x36af83, kind: side < 0 ? 'can' as const : 'cone' as const }
})).flat()
export const smallBoats = [
  { x: -38, z: 67, yaw: 0.4, sail: false, name: 'Motor launch' },
  { x: -110, z: 80, yaw: -0.8, sail: true, name: 'Sailing yacht' },
  { x: 120, z: -75, yaw: 2.1, sail: false, name: 'Fishing boat' },
  { x: 160, z: 40, yaw: 1.3, sail: true, name: 'Sailboat on port beam' },
] as const
export const navigationBuoys = [[22, 8, 0xe7543e], [-24, -10, 0x31b475], [30, -45, 0xe5bd4c], [-50, 40, 0x31b475], [8, 80, 0xe7543e], [65, 62, 0xe5bd4c]] as const
export const wreckPositions = [[52, 30, 19, -0.8, 0.45], [-85, -95, 34, 1.1, -0.5]] as const
export const tenderPosition = { x: 15, z: -32 }
export interface RadarContact { name: string; kind: 'ship' | 'boat' | 'buoy' | 'wreck'; x: number; z: number; yaw: number; speed: number }
export function radarContacts(seconds: number): RadarContact[] {
  return [
    ...cargoRoutes.map(route => ({ name: route.name, kind: 'ship' as const, ...cargoPose(route, seconds) })),
    ...trafficFleet.map(vessel => ({ name: vessel.name, kind: ['container', 'tanker', 'ferry'].includes(vessel.type) ? 'ship' as const : 'boat' as const, ...trafficPose(vessel, seconds) })),
    ...smallBoats.map(boat => ({ ...boat, kind: 'boat' as const, speed: 0 })),
    { name: 'Yacht tender', kind: 'boat', ...tenderPosition, yaw: 0, speed: 0 },
    ...navigationBuoys.map(([x, z], i) => ({ name: `Buoy ${i + 1}`, kind: 'buoy' as const, x, z, yaw: 0, speed: 0 })),
    ...cruiseBuoys.map(buoy => ({ name: buoy.name, kind: 'buoy' as const, x: buoy.x, z: buoy.z, yaw: 0, speed: 0 })),
    ...wreckPositions.map(([x, z], i) => ({ name: `Wreck ${i + 1}`, kind: 'wreck' as const, x, z, yaw: 0, speed: 0 })),
  ]
}
export function radarBearing(x: number, z: number) { return (Math.atan2(-x, z) * 180 / Math.PI + 360) % 360 }

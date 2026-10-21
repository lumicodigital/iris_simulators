import { cargoPose, cargoRoutes, coastalIslands, islandEdge, islandBridge, spinnakerTower, radarBearing, radarContacts, trafficFleet, trafficPose, yachtPose, yachtCruiseDuration } from '../simulation/maritime'
import type { SceneEnvironment } from '../simulation/environment'

export function drawRadar(ctx: CanvasRenderingContext2D, seconds: number, environment: SceneEnvironment = 'yacht') {
  const active = environment === 'yacht'
  const contacts = active ? radarContacts(seconds) : []
  const own = active ? yachtPose(seconds) : { x: 0, z: 0, yaw: 0, speed: 0 }
  const ships = contacts.filter(item => item.kind === 'ship')
  const shipLabels = new Map(ships.map((ship, i) => [ship.name, `C${i + 1}`]))
  const chartX = (x: number) => -(x - own.x) * scale
  const chartY = (z: number) => -(z - own.z) * scale
  const range = 926; const radius = 294; const scale = radius / range
  ctx.fillStyle = '#020d0c'; ctx.fillRect(0, 0, 1280, 720)
  ctx.textAlign = 'left'; ctx.font = '500 23px ui-monospace, monospace'; ctx.fillStyle = '#82dcbd'
  ctx.fillText('RADAR / CHART PLOTTER', 28, 40)
  ctx.font = '18px ui-monospace, monospace'; ctx.fillStyle = '#467f70'
  ctx.fillText(`NORTH UP    RANGE 0.5 NM    ${active ? 'LIVE YACHT SCENE' : 'CALIBRATION VISTA'}`, 28, 68)
  ctx.save(); ctx.translate(590, 385)
  ctx.strokeStyle = '#164d3a'; ctx.lineWidth = 1.5
  for (let i = 1; i <= 4; i++) { ctx.beginPath(); ctx.arc(0, 0, radius * i / 4, 0, Math.PI * 2); ctx.stroke() }
  for (let bearing = 0; bearing < 360; bearing += 10) {
    const angle = (bearing - 90) * Math.PI / 180
    ctx.beginPath(); ctx.moveTo(Math.cos(angle) * (radius - (bearing % 30 ? 7 : 15)), Math.sin(angle) * (radius - (bearing % 30 ? 7 : 15)))
    ctx.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius); ctx.stroke()
    if (bearing % 30 === 0) {
      ctx.textAlign = 'center'; ctx.font = '17px ui-monospace, monospace'; ctx.fillStyle = '#72a58c'
      ctx.fillText(bearing === 0 ? 'N' : String(bearing).padStart(3, '0'), Math.cos(angle) * (radius + 23), Math.sin(angle) * (radius + 23) + 6)
    }
  }
  ctx.beginPath(); ctx.arc(0, 0, radius, 0, Math.PI * 2); ctx.clip()
  ctx.strokeStyle = '#194334'; ctx.setLineDash([5, 7])
  ctx.beginPath(); ctx.moveTo(-radius, 0); ctx.lineTo(radius, 0); ctx.moveTo(0, -radius); ctx.lineTo(0, radius); ctx.stroke(); ctx.setLineDash([])
  if (active) {
    // This coastline uses the same irregular island outlines as the 3D terrain.
    for (const island of coastalIslands) {
      ctx.beginPath()
      for (let i = 0; i <= 64; i++) {
        const angle = i / 64 * Math.PI * 2; const edge = islandEdge(angle) * 0.96
        const x = chartX(island.x + Math.cos(angle) * island.rx * edge)
        const y = chartY(island.z + Math.sin(angle) * island.rz * edge)
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
      }
      ctx.closePath(); ctx.fillStyle = '#244c36'; ctx.strokeStyle = '#68a57c'; ctx.fill(); ctx.stroke()
    }
    ctx.strokeStyle = '#84aab0'; ctx.lineWidth = 3
    ctx.beginPath(); ctx.moveTo(chartX(islandBridge.from.x), chartY(islandBridge.from.z)); ctx.lineTo(chartX(islandBridge.to.x), chartY(islandBridge.to.z)); ctx.stroke()
    ctx.fillStyle = '#bdd5dd'; ctx.fillRect(chartX(spinnakerTower.x) - 3, chartY(spinnakerTower.z) - 3, 6, 6)
    ctx.font = '13px ui-monospace, monospace'; ctx.textAlign = 'left'; ctx.fillText('Spinnaker', chartX(spinnakerTower.x) + 8, chartY(spinnakerTower.z) - 6)
    ctx.strokeStyle = '#438c8a'; ctx.lineWidth = 1.5; ctx.setLineDash([6, 8]); ctx.beginPath()
    for (let i = 0; i <= 360; i++) { const pose = yachtPose(i / 360 * yachtCruiseDuration); if (!i) ctx.moveTo(chartX(pose.x), chartY(pose.z)); else ctx.lineTo(chartX(pose.x), chartY(pose.z)) }
    ctx.stroke(); ctx.setLineDash([])
    // Position history is sampled from the same paths, so trails survive view changes.
    for (const route of cargoRoutes) for (let age = 10; age <= 90; age += 10) {
      const pose = cargoPose(route, seconds - age)
      ctx.fillStyle = `rgba(121,220,159,${0.45 * (1 - age / 100)})`
      ctx.beginPath(); ctx.arc(chartX(pose.x), chartY(pose.z), 2, 0, Math.PI * 2); ctx.fill()
    }
    for (const vessel of trafficFleet) for (let age = 20; age <= 80; age += 20) {
      const pose = trafficPose(vessel, seconds - age)
      if (Math.hypot(pose.x - own.x, pose.z - own.z) > range) continue
      ctx.fillStyle = `rgba(121,220,159,${0.35 * (1 - age / 100)})`; ctx.beginPath(); ctx.arc(chartX(pose.x), chartY(pose.z), 1.5, 0, Math.PI * 2); ctx.fill()
    }
  }
  const sweep = seconds * Math.PI / 2 - Math.PI / 2
  for (let i = 40; i >= 0; i--) {
    ctx.fillStyle = `rgba(85,255,128,${0.0011 * (40 - i)})`
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, radius, sweep - i * .011, sweep - (i - 1) * .011); ctx.closePath(); ctx.fill()
  }
  ctx.strokeStyle = '#77f3a7'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(sweep) * radius, Math.sin(sweep) * radius); ctx.stroke()
  for (const target of contacts) {
    const x = chartX(target.x); const y = chartY(target.z)
    ctx.save(); ctx.translate(x, y)
    ctx.fillStyle = target.kind === 'buoy' ? '#e7cb75' : target.kind === 'wreck' ? '#ca9070' : '#9bf8a2'
    if (target.kind === 'ship' || target.kind === 'boat') {
      ctx.rotate(-target.yaw); const size = target.kind === 'ship' ? 7 : 4
      ctx.beginPath(); ctx.moveTo(0, -size * 1.5); ctx.lineTo(size * .7, size); ctx.lineTo(-size * .7, size); ctx.closePath(); ctx.fill()
      ctx.rotate(target.yaw)
    } else if (target.kind === 'wreck') {
      ctx.strokeStyle = '#ca9070'; ctx.beginPath(); ctx.moveTo(-3, -3); ctx.lineTo(3, 3); ctx.moveTo(3, -3); ctx.lineTo(-3, 3); ctx.stroke()
    } else { ctx.beginPath(); ctx.arc(0, 0, 2.2, 0, Math.PI * 2); ctx.fill() }
    if (target.kind === 'ship') { ctx.font = '15px ui-monospace, monospace'; ctx.fillStyle = '#b2e8c2'; ctx.textAlign = 'left'; ctx.fillText(shipLabels.get(target.name)!, 12, -7) }
    ctx.restore()
  }
  ctx.save(); ctx.rotate(-own.yaw)
  ctx.fillStyle = '#d1fbe4'; ctx.beginPath(); ctx.moveTo(0, -12); ctx.lineTo(7, 9); ctx.lineTo(0, 5); ctx.lineTo(-7, 9); ctx.closePath(); ctx.fill(); ctx.restore()
  ctx.restore()
  ctx.textAlign = 'left'; ctx.fillStyle = '#11251f'; ctx.fillRect(960, 90, 294, 586)
  function text(value: string, y: number, size = 18, color = '#aadfbc') { ctx.font = `${size}px ui-monospace, monospace`; ctx.fillStyle = color; ctx.fillText(value, 982, y) }
  text(active ? 'OWN YACHT · CRUISING' : 'OWN YACHT · STATIONARY', 124, 16, '#598573')
  const heading = Math.round(radarBearing(Math.sin(own.yaw), Math.cos(own.yaw))) % 360
  text(`${String(heading).padStart(3, '0')}° / ${(own.speed * 1.94384).toFixed(1)} kn`, 156, 25)
  text('RANGE 0.5 NM / 926 m', 198, 17)
  text(`${contacts.length} SCENE CONTACTS`, 240, 20)
  const nearestShips = [...ships].sort((a, b) => Math.hypot(a.x - own.x, a.z - own.z) - Math.hypot(b.x - own.x, b.z - own.z)).slice(0, 2)
  for (const [i, target] of nearestShips.entries()) {
    const top = 292 + i * 126
    text(`${shipLabels.get(target.name)} ${target.name.replace(/^(Container ship|Cargo ship|Product tanker|Island ferry) /, '').slice(0, 16)}`, top, 20)
    text(`${Math.round(Math.hypot(target.x - own.x, target.z - own.z))} m  BRG ${String(Math.round(radarBearing(target.x - own.x, target.z - own.z)) % 360).padStart(3, '0')}°`, top + 30, 16)
    text(`${(target.speed * 1.94384).toFixed(1)} kn  ·  LIVE`, top + 57, 16, '#69b088')
  }
  text(active ? `${contacts.filter(item => item.kind === 'ship' || item.kind === 'boat').length} vessels / ${contacts.filter(item => item.kind === 'buoy').length} buoys` : 'Yacht scene inactive', 578, 14, '#719c87')
  if (active) text(`Cruise loop ${Math.floor(seconds % yachtCruiseDuration / yachtCruiseDuration * 100)}%`, 606, 14, '#719c87')
  text('Green: vessels', 642, 14, '#719c87'); text('Gold: buoys  Rust: wrecks', 662, 13, '#719c87')
  ctx.font = '16px ui-monospace, monospace'; ctx.fillStyle = '#3e7359'; ctx.fillText('CHART PLOTTER VIDEO OUTPUT · NORTH UP · LIVE YACHT POSITION', 28, 706)
}

export function drawStreaming(ctx: CanvasRenderingContext2D, seconds: number) {
  const sky = ctx.createLinearGradient(0, 0, 0, 720)
  sky.addColorStop(0, '#12132d'); sky.addColorStop(.48, '#544568'); sky.addColorStop(.67, '#d28d7e'); sky.addColorStop(1, '#0e2434')
  ctx.fillStyle = sky; ctx.fillRect(0, 0, 1280, 720)
  const drift = Math.sin(seconds * .03) * 18
  ctx.fillStyle = '#e8d9bd'; ctx.beginPath(); ctx.arc(904 + drift, 224, 63, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = '#233340'; ctx.beginPath(); ctx.moveTo(0, 459); ctx.lineTo(200, 292); ctx.lineTo(351, 432); ctx.lineTo(470, 343); ctx.lineTo(644, 467); ctx.lineTo(720, 423); ctx.lineTo(817, 468); ctx.lineTo(1030, 379); ctx.lineTo(1280, 490); ctx.lineTo(1280, 720); ctx.lineTo(0, 720); ctx.closePath(); ctx.fill()
  ctx.fillStyle = '#101e2c'; ctx.beginPath(); ctx.moveTo(0, 560); ctx.lineTo(150, 482); ctx.lineTo(233, 520); ctx.lineTo(365, 466); ctx.lineTo(520, 566); ctx.lineTo(680, 530); ctx.lineTo(850, 605); ctx.lineTo(1050, 475); ctx.lineTo(1280, 558); ctx.lineTo(1280, 720); ctx.lineTo(0, 720); ctx.closePath(); ctx.fill()
  // Original preview artwork: a sailboat against a moving dusk seascape.
  ctx.fillStyle = '#060f19'; ctx.beginPath(); ctx.moveTo(870, 508); ctx.lineTo(1025, 508); ctx.lineTo(1000, 530); ctx.lineTo(900, 530); ctx.closePath(); ctx.fill()
  ctx.fillRect(950, 330, 4, 181); ctx.beginPath(); ctx.moveTo(944, 345); ctx.lineTo(944, 496); ctx.lineTo(877, 496); ctx.closePath(); ctx.fill()
  ctx.fillStyle = '#304650'; ctx.beginPath(); ctx.moveTo(962, 365); ctx.lineTo(962, 494); ctx.lineTo(1013, 494); ctx.closePath(); ctx.fill()
  ctx.strokeStyle = '#7f939b33'; ctx.lineWidth = 2
  for (let i = 0; i < 9; i++) { const x = (i * 173 + seconds * 8) % 1400 - 100; ctx.beginPath(); ctx.moveTo(x, 554 + i * 14); ctx.lineTo(x + 65, 554 + i * 14); ctx.stroke() }
  const shade = ctx.createLinearGradient(0, 0, 900, 0); shade.addColorStop(0, '#06080ed9'); shade.addColorStop(1, '#0000'); ctx.fillStyle = shade; ctx.fillRect(0, 0, 1280, 720)
  ctx.fillStyle = '#e50914'; ctx.font = '800 36px Arial, sans-serif'; ctx.fillText('NETFLIX', 38, 55)
  ctx.font = '16px Arial, sans-serif'; ctx.fillStyle = '#ffffffb3'; ctx.fillText('MOVIE PREVIEW', 224, 48)
  ctx.fillStyle = '#ddd7ce'; ctx.font = '600 20px Arial, sans-serif'; ctx.fillText('A JOURNEY BEYOND THE SHORE', 52, 339)
  ctx.fillStyle = '#fff'; ctx.font = '700 59px Georgia, serif'; ctx.fillText('THE LAST', 48, 407); ctx.fillText('HORIZON', 48, 473)
  ctx.font = '21px Arial, sans-serif'; ctx.fillStyle = '#d4d2d4'; ctx.fillText('Adventure  ·  1h 48m  ·  HD', 52, 516)
  ctx.fillStyle = '#0009'; ctx.fillRect(0, 618, 1280, 102)
  ctx.fillStyle = '#eee'; ctx.fillRect(44, 652, 5, 20); ctx.fillRect(55, 652, 5, 20)
  ctx.fillStyle = '#ffffff40'; ctx.fillRect(88, 660, 1030, 4); ctx.fillStyle = '#e50914'; ctx.fillRect(88, 660, 1030 * ((seconds % 6480) / 6480), 4)
  const time = Math.floor(seconds)
  ctx.font = '18px ui-monospace, monospace'; ctx.fillStyle = '#bbb'; ctx.fillText(`${String(Math.floor(time / 60) % 108).padStart(2, '0')}:${String(time % 60).padStart(2, '0')} / 1:48:00`, 88, 697)
  ctx.font = '16px Arial, sans-serif'; ctx.fillStyle = '#bbb'; ctx.fillText('PREVIEW PLAYBACK', 1080, 696)
}

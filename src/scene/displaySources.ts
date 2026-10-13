export function drawRadar(ctx: CanvasRenderingContext2D, seconds: number) {
  ctx.fillStyle = '#020d0c'; ctx.fillRect(0, 0, 1280, 720)
  ctx.font = '500 23px ui-monospace, monospace'; ctx.fillStyle = '#82dcbd'
  ctx.fillText('RADAR / CHART PLOTTER', 28, 40)
  ctx.font = '18px ui-monospace, monospace'; ctx.fillStyle = '#467f70'
  ctx.fillText('HEAD UP    RANGE 2.0 NM', 28, 68)
  const x = 590; const y = 385; const radius = 294
  ctx.save(); ctx.translate(x, y)
  ctx.strokeStyle = '#164d3a'; ctx.lineWidth = 1.5
  for (let i = 1; i <= 4; i++) { ctx.beginPath(); ctx.arc(0, 0, radius * i / 4, 0, Math.PI * 2); ctx.stroke() }
  for (let bearing = 0; bearing < 360; bearing += 10) {
    const a = (bearing - 90) * Math.PI / 180
    ctx.beginPath(); ctx.moveTo(Math.cos(a) * (radius - (bearing % 30 ? 7 : 15)), Math.sin(a) * (radius - (bearing % 30 ? 7 : 15)))
    ctx.lineTo(Math.cos(a) * radius, Math.sin(a) * radius); ctx.stroke()
    if (bearing % 30 === 0) {
      ctx.textAlign = 'center'; ctx.font = '17px ui-monospace, monospace'; ctx.fillStyle = '#72a58c'
      ctx.fillText(bearing === 0 ? 'N' : String(bearing).padStart(3, '0'), Math.cos(a) * (radius + 23), Math.sin(a) * (radius + 23) + 6)
    }
  }
  ctx.beginPath(); ctx.rect(-radius - 1, -radius - 1, 2 * radius + 2, 2 * radius + 2); ctx.clip()
  ctx.strokeStyle = '#194334'; ctx.setLineDash([5, 7])
  ctx.beginPath(); ctx.moveTo(-radius, 0); ctx.lineTo(radius, 0); ctx.moveTo(0, -radius); ctx.lineTo(0, radius); ctx.stroke(); ctx.setLineDash([])
  // A chart shoreline and harbor returns, distinct from the simulated camera feed.
  ctx.fillStyle = '#2c754d'; ctx.strokeStyle = '#68c483'; ctx.lineWidth = 2
  ctx.beginPath(); ctx.moveTo(215, -245); ctx.lineTo(165, -180); ctx.lineTo(196, -137); ctx.lineTo(159, -92); ctx.lineTo(191, -35); ctx.lineTo(178, 18); ctx.lineTo(225, 65); ctx.lineTo(234, 120); ctx.lineTo(295, 145); ctx.lineTo(295, -295); ctx.closePath(); ctx.fill(); ctx.stroke()
  const angle = seconds * Math.PI / 2 - Math.PI / 2
  for (let i = 40; i >= 0; i--) {
    ctx.fillStyle = `rgba(85,255,128,${0.0015 * (40 - i)})`
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, radius, angle - i * .011, angle - (i - 1) * .011); ctx.closePath(); ctx.fill()
  }
  ctx.strokeStyle = '#77f3a7'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius); ctx.stroke()
  const targets = [[-126, -153], [65, -208], [-201, 88], [87, 119], [120, -78]]
  targets.forEach(([tx, ty], index) => {
    const drift = Math.sin(seconds * .1 + index) * 6
    ctx.fillStyle = '#9bf8a2'; ctx.shadowColor = '#62fd88'; ctx.shadowBlur = 8
    ctx.beginPath(); ctx.arc(tx + drift, ty, 4, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0
    ctx.strokeStyle = '#588562'; ctx.strokeRect(tx + drift - 10, ty - 10, 20, 20)
    ctx.font = '15px ui-monospace, monospace'; ctx.fillStyle = '#82b99b'; ctx.textAlign = 'left'; ctx.fillText(`T${index + 1}`, tx + drift + 14, ty - 8)
  })
  ctx.fillStyle = '#d1fbe4'; ctx.beginPath(); ctx.moveTo(0, -12); ctx.lineTo(7, 9); ctx.lineTo(0, 5); ctx.lineTo(-7, 9); ctx.closePath(); ctx.fill()
  ctx.restore()
  ctx.textAlign = 'left'; ctx.fillStyle = '#11251f'; ctx.fillRect(960, 90, 294, 586)
  const values = [['HEADING', '084°'], ['SPEED', '8.2 kn'], ['RANGE', '2.0 NM'], ['GAIN', 'AUTO'], ['TARGETS', '5 TRACKED']]
  values.forEach(([title, value], i) => {
    ctx.font = '16px ui-monospace, monospace'; ctx.fillStyle = '#598573'; ctx.fillText(title, 984, 134 + i * 98)
    ctx.font = '27px ui-monospace, monospace'; ctx.fillStyle = '#aadfbc'; ctx.fillText(value, 984, 174 + i * 98)
  })
  ctx.font = '16px ui-monospace, monospace'; ctx.fillStyle = '#3e7359'; ctx.fillText('CHART PLOTTER VIDEO OUTPUT', 28, 706)
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

import * as THREE from 'three'

export interface DistrictBuilding { x: number; z: number; w: number; d: number; h: number; base: number; bottom: number; color: number; seed: number }
type Shape = 'box' | 'round' | 'taper' | 'gable' | 'pyramid' | 'dome'
interface Part { matrix: THREE.Matrix4; color: number; grid?: [number, number]; atlas?: [number, number] }

export function createDistrictBuildings(city: THREE.Group, nightLights: THREE.Group, buildings: DistrictBuilding[]) {
  const bodies = new Map<Shape, Part[]>(); const windows = new Map<'plane' | 'round' | 'taper', Part[]>()
  const styles: Record<string, number> = {}
  const up = new THREE.Vector3(0, 1, 0)
  const random = (seed: number) => { const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453; return value - Math.floor(value) }
  function part(shape: Shape, x: number, y: number, z: number, w: number, h: number, d: number, color: number, yaw = 0) {
    const item = { matrix: new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(up, yaw), new THREE.Vector3(w, h, d)), color }
    const bucket = bodies.get(shape) ?? []; bucket.push(item); bodies.set(shape, bucket); return item
  }
  function glazing(shape: 'plane' | 'round' | 'taper', matrix: THREE.Matrix4, columns: number, floors: number, style: number) {
    const bucket = windows.get(shape) ?? []
    bucket.push({ matrix, color: 0xffffff, grid: [columns / 8, floors / 8], atlas: [style % 2, Math.floor(style / 2)] }); windows.set(shape, bucket)
  }
  function block(x: number, z: number, w: number, h: number, d: number, bottom: number, color: number, style: number, yaw = 0) {
    part('box', x, bottom + h / 2, z, w, h, d, color, yaw)
    for (let side = 0; side < 4; side++) {
      const angle = side * Math.PI / 2; const sx = Math.sin(angle) * (w / 2 + 0.08); const sz = Math.cos(angle) * (d / 2 + 0.08)
      const matrix = new THREE.Matrix4().compose(new THREE.Vector3(x + sx * Math.cos(yaw) + sz * Math.sin(yaw), bottom + h / 2, z - sx * Math.sin(yaw) + sz * Math.cos(yaw)), new THREE.Quaternion().setFromAxisAngle(up, angle + yaw), new THREE.Vector3((side % 2 ? d : w) - 1.5, h - 1.5, 1))
      glazing('plane', matrix, Math.max(2, (side % 2 ? d : w) / 3.5), Math.max(1, h / 3.8), style)
    }
  }
  for (const building of buildings) {
    const { x, z, w, d, h, base, bottom, seed } = building
    const style = h > 60 ? ['stepped', 'round', 'twin', 'spire', 'taper'][Math.floor(random(seed + 71) * 5)]! : ['townhouses', 'hotel', 'warehouse', 'civic'][Math.floor(random(seed + 71) * 4)]!
    styles[style] = (styles[style] ?? 0) + 1
    part('box', x, (base + bottom) / 2, z, w + 3, base - bottom, d + 3, 0x969c98)
    if (style === 'stepped') {
      let y = base
      for (const [i, fraction] of [0.5, 0.3, 0.2].entries()) { block(x - i * w * 0.06, z, w * (1 - i * 0.23), h * fraction, d * (1 - i * 0.2), y, building.color, i % 2 ? 3 : 0); y += h * fraction }
      part('pyramid', x - w * 0.12, y + 4, z, w * 0.35, 8, d * 0.35, 0xa2b7bd)
    } else if (style === 'round' || style === 'taper') {
      const shape = style === 'round' ? 'round' : 'taper'
      part(shape, x, base + h / 2, z, w, h, d, 0x6a8792)
      const matrix = new THREE.Matrix4().compose(new THREE.Vector3(x, base + h / 2, z), new THREE.Quaternion(), new THREE.Vector3(w + 0.18, h - 2, d + 0.18))
      glazing(shape, matrix, Math.PI * (w + d) / 2 / 3.5, h / 3.8, style === 'round' ? 0 : 3)
      part('round', x, base + h + 1, z, w * 1.04, 2, d * 1.04, 0xd5dad7)
      if (style === 'round') part('dome', x, base + h + 2, z, w * 0.7, 12, d * 0.7, 0x9db5ba)
    } else if (style === 'twin') {
      block(x - w * 0.27, z, w * 0.42, h, d * 0.8, base, 0xd4dedb, 0)
      block(x + w * 0.27, z, w * 0.42, h * 0.82, d * 0.8, base, 0xa9c0c7, 3)
      block(x, z, w * 0.7, 4, d * 0.32, base + h * 0.57, 0xc4d5d9, 0)
    } else if (style === 'spire') {
      block(x, z, w * 0.9, h * 0.82, d * 0.9, base, 0xdac7a5, 3)
      part('pyramid', x, base + h * 0.91, z, w * 0.9, h * 0.18, d * 0.9, 0x597f83)
    } else if (style === 'townhouses') {
      const count = 3; const width = w / count
      for (let i = 0; i < count; i++) {
        const px = x + (i - 1) * width; const height = Math.min(h, 24) * (0.8 + random(seed + i + 25) * 0.2)
        const paint = [0xc78268, 0xe3d4ae, 0xa3bdb2, 0xd9bba6][Math.floor(random(seed + i + 32) * 4)]!
        block(px, z, width - 0.4, height, d * 0.9, base, paint, 2)
        part('gable', px, base + height, z, width + 0.5, 4 + random(seed + i) * 3, d * 0.97, [0x8d5143, 0x566b72, 0x976d4e][i]!)
        part('box', px + width * 0.2, base + height + 3, z - d * 0.25, 1.1, 4, 1.2, 0x98634c)
      }
    } else if (style === 'warehouse') {
      const height = Math.min(h, 15)
      block(x, z, w, height, d, base, 0xab7760, 2)
      for (const side of [-1, 1]) part('gable', x + side * w * 0.25, base + height, z, w * 0.51, 5.5, d * 1.04, 0x637b7d)
      part('box', x, base + 2, z + d * 0.51, w * 0.48, 4, 0.25, 0x3e5258)
    } else if (style === 'hotel') {
      block(x, z, w, h * 0.7, d, base, 0xe7deca, 1)
      block(x, z - d * 0.1, w * 0.72, h * 0.3, d * 0.65, base + h * 0.7, 0xefe5cf, 1)
      for (let y = base + 4; y < base + h * 0.7; y += 4.5) part('box', x, y, z, w + 1.7, 0.35, d + 1.7, 0xf1eadd)
      part('box', x, base + h * 0.7 + 0.1, z + d * 0.3, w * 0.6, 0.2, d * 0.2, 0x4595a5)
    } else {
      const height = Math.min(h, 24)
      block(x, z, w, height, d * 0.7, base, 0xded5bd, 1)
      part('dome', x, base + height, z, w * 0.65, w * 0.38, d * 0.65, 0x628d89)
      for (let i = 0; i < 5; i++) part('round', x + (i - 2) * w * 0.18, base + height * 0.38, z + d * 0.46, 0.9, height * 0.76, 0.9, 0xece5ce)
      part('pyramid', x, base + height * 0.78, z + d * 0.4, w * 1.02, 4, d * 0.35, 0xd8d1bb)
    }
    if (h > 90) {
      part('round', x, base + h + 6, z, 0.5, 12, 0.5, 0xb8c6ce)
      const light = new THREE.Mesh(new THREE.SphereGeometry(0.7, 6, 4), new THREE.MeshBasicMaterial({ color: 0xff8060, toneMapped: false })); light.position.set(x, base + h + 12, z); nightLights.add(light)
    }
  }
  const triangle = new THREE.Shape(); triangle.moveTo(-0.5, 0); triangle.lineTo(0.5, 0); triangle.lineTo(0, 1); triangle.closePath()
  const gable = new THREE.ExtrudeGeometry(triangle, { depth: 1, bevelEnabled: false }); gable.translate(0, 0, -0.5)
  const geometry: Record<Shape, THREE.BufferGeometry> = {
    box: new THREE.BoxGeometry(1, 1, 1), round: new THREE.CylinderGeometry(0.5, 0.5, 1, 24), taper: new THREE.CylinderGeometry(0.42, 0.5, 1, 8),
    pyramid: new THREE.ConeGeometry(Math.SQRT1_2, 1, 4).rotateY(Math.PI / 4), gable,
    dome: new THREE.SphereGeometry(0.5, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2),
  }
  const masonry = new THREE.MeshStandardMaterial({ roughness: 0.75, metalness: 0.12 })
  const paint = new THREE.Color()
  for (const [shape, parts] of bodies) {
    const object = new THREE.InstancedMesh(geometry[shape], masonry, parts.length); object.name = `District architecture · ${shape}`; object.userData.heat = 0.31
    parts.forEach((item, i) => { object.setMatrixAt(i, item.matrix); object.setColorAt(i, paint.set(item.color)) }); object.computeBoundingSphere(); city.add(object)
  }
  const facadeCanvas = document.createElement('canvas'); facadeCanvas.width = facadeCanvas.height = 512
  const emissiveCanvas = document.createElement('canvas'); emissiveCanvas.width = emissiveCanvas.height = 512
  const facade = facadeCanvas.getContext('2d')!; const emission = emissiveCanvas.getContext('2d')!
  emission.fillStyle = '#000'; emission.fillRect(0, 0, 512, 512)
  for (let style = 0; style < 4; style++) {
    const ox = style % 2 * 256; const oy = (1 - Math.floor(style / 2)) * 256
    facade.fillStyle = ['#253b4b', '#e1d8c5', '#a37963', '#5f655e'][style]!; facade.fillRect(ox, oy, 256, 256)
    for (let row = 0; row < 8; row++) for (let column = 0; column < 8; column++) {
      const x = ox + column * 32; const y = oy + row * 32
      if (style === 2) { facade.fillStyle = '#c29a7d'; facade.fillRect(x, y + 15, 32, 1); facade.fillRect(x + 15, y, 1, 15) }
      const width = style === 0 ? 28 : style === 1 ? 24 : 17
      facade.fillStyle = ['#718f9d', '#426875', '#3b535d', '#a79570'][style]!; facade.fillRect(x + (32 - width) / 2, y + 5, width, 22)
      if (style === 1) { facade.fillStyle = '#f7efda'; facade.fillRect(x, y + 28, 32, 3) }
      if (random(row * 17 + column * 3 + style * 81) > (style === 2 ? 0.5 : 0.37)) { emission.fillStyle = style === 0 ? '#a8c8dc' : '#ffd099'; emission.fillRect(x + (32 - width) / 2, y + 5, width, 22) }
    }
  }
  const facadeTexture = new THREE.CanvasTexture(facadeCanvas); facadeTexture.colorSpace = THREE.SRGBColorSpace
  const emissiveTexture = new THREE.CanvasTexture(emissiveCanvas); emissiveTexture.colorSpace = THREE.SRGBColorSpace
  const facadeMaterial = new THREE.MeshStandardMaterial({ map: facadeTexture, emissiveMap: emissiveTexture, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.35, metalness: 0.3, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 })
  facadeMaterial.onBeforeCompile = shader => {
    shader.vertexShader = 'attribute vec2 facadeGrid; attribute vec2 facadeAtlas; varying vec2 facadeUv; varying vec2 facadeTile;\n' + shader.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\n facadeUv = uv * facadeGrid; facadeTile = facadeAtlas;')
    const uv = '(facadeTile * 256.0 + vec2(1.0) + fract(facadeUv) * 254.0) / 512.0'
    shader.fragmentShader = 'varying vec2 facadeUv; varying vec2 facadeTile;\n' + shader.fragmentShader
      .replace('#include <map_fragment>', THREE.ShaderChunk.map_fragment.replace('texture2D( map, vMapUv )', `texture2D( map, ${uv} )`))
      .replace('#include <emissivemap_fragment>', THREE.ShaderChunk.emissivemap_fragment.replace('texture2D( emissiveMap, vEmissiveMapUv )', `texture2D( emissiveMap, ${uv} )`))
  }
  for (const [shape, parts] of windows) {
    const windowGeometry = shape === 'plane' ? new THREE.PlaneGeometry(1, 1) : new THREE.CylinderGeometry(shape === 'taper' ? 0.42 : 0.5, 0.5, 1, shape === 'taper' ? 8 : 32, 1, true)
    windowGeometry.setAttribute('facadeGrid', new THREE.InstancedBufferAttribute(new Float32Array(parts.flatMap(item => item.grid!)), 2))
    windowGeometry.setAttribute('facadeAtlas', new THREE.InstancedBufferAttribute(new Float32Array(parts.flatMap(item => item.atlas!)), 2))
    const object = new THREE.InstancedMesh(windowGeometry, facadeMaterial, parts.length); object.name = `District windows · ${shape}`; object.userData.heat = 0.43
    parts.forEach((item, i) => object.setMatrixAt(i, item.matrix)); object.computeBoundingSphere(); city.add(object)
  }
  city.userData.architectureStyles = styles
  return { setNight(night: boolean) { facadeMaterial.emissiveIntensity = night ? 1.15 : 0 }, dispose() { emissiveTexture.dispose() } }
}

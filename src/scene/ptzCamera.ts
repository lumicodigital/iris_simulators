import * as THREE from 'three'

// Dimensions are visual proportions from the supplied camera references.
// The mounting foot stays fixed, the outer yoke pans, and the lens head tilts.
export function createPtzCamera(scene: THREE.Object3D) {
  const white = new THREE.MeshPhysicalMaterial({ color: 0xeeefed, metalness: 0.08, roughness: 0.32, clearcoat: 0.5, clearcoatRoughness: 0.24 })
  const faceWhite = new THREE.MeshPhysicalMaterial({ color: 0xf4f4f0, metalness: 0.03, roughness: 0.36, clearcoat: 0.3 })
  const seam = new THREE.MeshStandardMaterial({ color: 0x5a6265, metalness: 0.15, roughness: 0.64 })
  const recess = new THREE.MeshStandardMaterial({ color: 0x999fa0, metalness: 0.2, roughness: 0.55 })
  const black = new THREE.MeshStandardMaterial({ color: 0x090e11, metalness: 0.45, roughness: 0.28 })
  const lensMetal = new THREE.MeshStandardMaterial({ color: 0x263033, metalness: 0.8, roughness: 0.22 })
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x0a161b, metalness: 0.55, roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.04 })
  const fastener = new THREE.MeshStandardMaterial({ color: 0xaeb5b6, metalness: 0.8, roughness: 0.35 })

  function mesh(geometry: THREE.BufferGeometry, material: THREE.Material, parent: THREE.Object3D, x = 0, y = 0, z = 0) {
    const item = new THREE.Mesh(geometry, material)
    item.position.set(x, y, z); item.castShadow = true; item.receiveShadow = true
    parent.add(item)
    return item
  }
  function lathe(profile: number[][], material: THREE.Material, parent: THREE.Object3D) {
    return mesh(new THREE.LatheGeometry(profile.map(([radius, height]) => new THREE.Vector2(radius, height)), 96), material, parent)
  }
  function circle(radius: number, depth: number, material: THREE.Material, parent: THREE.Object3D, x: number, y: number, z: number) {
    const item = mesh(new THREE.CylinderGeometry(radius, radius, depth, 64), material, parent, x, y, z)
    item.rotation.x = Math.PI / 2
    return item
  }
  function ring(radius: number, thickness: number, material: THREE.Material, parent: THREE.Object3D, x: number, y: number, z: number) {
    return mesh(new THREE.TorusGeometry(radius, thickness, 12, 64), material, parent, x, y, z)
  }
  function roundedPanel(width: number, height: number, radius: number, depth: number) {
    const shape = new THREE.Shape()
    const x = -width / 2; const y = -height / 2
    shape.moveTo(x + radius, y)
    shape.lineTo(x + width - radius, y)
    shape.quadraticCurveTo(x + width, y, x + width, y + radius)
    shape.lineTo(x + width, y + height - radius)
    shape.quadraticCurveTo(x + width, y + height, x + width - radius, y + height)
    shape.lineTo(x + radius, y + height)
    shape.quadraticCurveTo(x, y + height, x, y + height - radius)
    shape.lineTo(x, y + radius)
    shape.quadraticCurveTo(x, y, x + radius, y)
    const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: 0.035, bevelSize: 0.035, bevelSegments: 4, curveSegments: 16, steps: 1 })
    return geometry
  }

  const mount = new THREE.Group()
  scene.add(mount)
  lathe([[0, 0.02], [1.07, 0.02], [1.13, 0.05], [1.145, 0.10], [1.13, 0.14], [1.09, 0.20], [1.03, 0.31], [0.96, 0.44], [0.88, 0.56], [0.84, 0.63], [0.83, 0.69], [0, 0.69]], white, mount)
  lathe([[1.125, 0.06], [1.139, 0.06], [1.139, 0.08], [1.125, 0.08]], recess, mount)
  // Recessed oval fixing holes around the sloping mounting flange.
  for (let index = 0; index < 6; index++) {
    const angle = index * Math.PI / 3
    const pocket = new THREE.Group()
    pocket.position.set(Math.sin(angle) * 1.005, 0.345, Math.cos(angle) * 1.005)
    pocket.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(Math.sin(angle), 0.5, Math.cos(angle)).normalize())
    pocket.scale.set(1, 1.6, 1)
    mount.add(pocket)
    circle(0.070, 0.020, recess, pocket, 0, 0, 0)
    ring(0.073, 0.010, faceWhite, pocket, 0, 0, 0.007)
    circle(0.041, 0.015, seam, pocket, 0, 0, -0.006)
  }
  lathe([[0, 0.68], [0.83, 0.68], [0.86, 0.72], [0.86, 0.81], [0.84, 0.85], [0, 0.85]], white, mount)
  lathe([[0.836, 0.81], [0.853, 0.81], [0.853, 0.827], [0.836, 0.827]], seam, mount)
  circle(0.042, 0.012, fastener, mount, 0, 0.765, 0.864)
  mesh(new THREE.BoxGeometry(0.047, 0.007, 0.006), seam, mount, 0, 0.765, 0.873)

  const pan = new THREE.Group()
  pan.position.y = 0.84
  scene.add(pan)
  lathe([[0, 0], [0.835, 0], [0.854, 0.035], [0.86, 0.09], [0.86, 0.60], [0.85, 0.66], [0.83, 0.70], [0, 0.70]], white, pan)
  // Fine horizontal joint where the upright yoke meets the cylindrical pan body.
  lathe([[0.839, 0.61], [0.855, 0.61], [0.855, 0.625], [0.839, 0.625]], recess, pan)

  const yoke = new THREE.Group()
  yoke.position.y = 0.66
  pan.add(yoke)

  // Two thick side shells with straight lower walls and domed shoulders leave
  // room at the front and back for the head and both lenses to tilt together.
  function shellSector(start: number, end: number) {
    const outerRadius = 0.87; const innerRadius = 0.765; const shoulder = 0.94
    const angularSteps = 24; const domeSteps = 24
    const outer: THREE.Vector2[] = [new THREE.Vector2(outerRadius, 0.025), new THREE.Vector2(outerRadius, shoulder)]
    const inner: THREE.Vector2[] = [new THREE.Vector2(innerRadius, 0.025), new THREE.Vector2(innerRadius, shoulder)]
    for (let row = 1; row <= domeSteps; row++) {
      const angle = row / domeSteps * Math.PI / 2
      outer.push(new THREE.Vector2(Math.max(0.001, outerRadius * Math.cos(angle)), shoulder + outerRadius * Math.sin(angle)))
      inner.push(new THREE.Vector2(Math.max(0.001, innerRadius * Math.cos(angle)), shoulder + innerRadius * Math.sin(angle)))
    }
    const rows = outer.length; const stride = angularSteps + 1
    const positions: number[] = []; const indices: number[] = []
    for (const profile of [outer, inner]) {
      for (const point of profile) {
        for (let column = 0; column <= angularSteps; column++) {
          const angle = start + (end - start) * column / angularSteps
          positions.push(point.x * Math.sin(angle), point.y, point.x * Math.cos(angle))
        }
      }
    }
    function quad(a: number, b: number, c: number, d: number) { indices.push(a, c, b, a, d, c) }
    const offset = rows * stride
    for (let row = 0; row < rows - 1; row++) {
      for (let column = 0; column < angularSteps; column++) {
        const a = row * stride + column
        quad(a, a + stride, a + stride + 1, a + 1)
        quad(a + offset, a + offset + 1, a + offset + stride + 1, a + offset + stride)
      }
      const left = row * stride; const right = left + angularSteps
      quad(left, left + offset, left + offset + stride, left + stride)
      quad(right, right + stride, right + offset + stride, right + offset)
    }
    for (let column = 0; column < angularSteps; column++) {
      quad(column, column + 1, column + offset + 1, column + offset)
      const top = (rows - 1) * stride + column
      quad(top, top + offset, top + offset + 1, top + 1)
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geometry.setIndex(indices); geometry.computeVertexNormals()
    return geometry
  }
  mesh(shellSector(THREE.MathUtils.degToRad(53), THREE.MathUtils.degToRad(127)), white, yoke)
  mesh(shellSector(THREE.MathUtils.degToRad(233), THREE.MathUtils.degToRad(307)), white, yoke)

  // Narrow seams trace the front edges of the side covers.
  for (const side of [-1, 1]) {
    const angle = side * THREE.MathUtils.degToRad(53)
    const seamPoints = [new THREE.Vector3(0.875 * Math.sin(angle), 0.045, 0.875 * Math.cos(angle)), new THREE.Vector3(0.875 * Math.sin(angle), 0.94, 0.875 * Math.cos(angle))]
    for (let index = 1; index <= 24; index++) {
      const arc = index / 24 * Math.PI / 2
      const radius = 0.875 * Math.cos(arc)
      seamPoints.push(new THREE.Vector3(radius * Math.sin(angle), 0.94 + 0.875 * Math.sin(arc), radius * Math.cos(angle)))
    }
    mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(seamPoints), 64, 0.007, 5, false), recess, yoke)
    // Countersunk fasteners follow the curved side panel.
    for (const height of [0.16, 0.59, 1.00, 1.40]) {
      const panelAngle = side * THREE.MathUtils.degToRad(64)
      const aboveShoulder = Math.max(0, height - 0.94)
      const radius = Math.sqrt(0.87 ** 2 - aboveShoulder ** 2)
      const screw = new THREE.Group()
      screw.position.set(radius * Math.sin(panelAngle), height, radius * Math.cos(panelAngle))
      screw.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(radius * Math.sin(panelAngle), aboveShoulder, radius * Math.cos(panelAngle)).normalize())
      yoke.add(screw)
      circle(0.038, 0.012, recess, screw, 0, 0, 0.003)
      circle(0.025, 0.015, fastener, screw, 0, 0, 0.009)
      mesh(new THREE.BoxGeometry(0.029, 0.004, 0.003), seam, screw, 0, 0, 0.019)
    }
  }

  const tilt = new THREE.Group()
  tilt.position.y = 0.66 + 0.94
  pan.add(tilt)
  const head = mesh(new THREE.SphereGeometry(1, 64, 48), white, tilt)
  head.scale.set(0.69, 0.84, 0.63)
  // The softly bevelled face plate has the same vertical lens arrangement as
  // the reference: optical zoom above, a smaller dark sensor window below.
  mesh(roundedPanel(1.05, 1.35, 0.31, 0.09), faceWhite, tilt, 0, 0.015, 0.545)
  const opticalY = 0.30
  circle(0.307, 0.12, black, tilt, 0, opticalY, 0.664)
  ring(0.300, 0.014, lensMetal, tilt, 0, opticalY, 0.724)
  circle(0.270, 0.025, black, tilt, 0, opticalY, 0.729)
  ring(0.250, 0.009, lensMetal, tilt, 0, opticalY, 0.745)
  ring(0.220, 0.008, black, tilt, 0, opticalY, 0.747)
  circle(0.207, 0.018, glass, tilt, 0, opticalY, 0.749)
  ring(0.176, 0.006, lensMetal, tilt, 0, opticalY, 0.760)
  circle(0.232, 0.035, black, tilt, 0, -0.345, 0.654)
  ring(0.230, 0.008, lensMetal, tilt, 0, -0.345, 0.674)
  circle(0.214, 0.015, glass, tilt, 0, -0.345, 0.679)
  const lowerWindow = mesh(new THREE.BoxGeometry(0.407, 0.009, 0.008), black, tilt, 0, -0.325, 0.690)
  lowerWindow.rotation.z = 0.025
  const ledMaterial = new THREE.MeshBasicMaterial({ color: 0x58dec0 })
  const reflection = mesh(new THREE.SphereGeometry(0.023, 12, 12), ledMaterial, tilt, 0.092, opticalY + 0.104, 0.767)
  reflection.scale.set(0.55, 1, 0.15)
  const reflectionWhite = mesh(new THREE.SphereGeometry(0.018, 12, 12), new THREE.MeshBasicMaterial({ color: 0xb0c4c8 }), tilt, -0.056, opticalY + 0.045, 0.767)
  reflectionWhite.scale.set(0.40, 1, 0.15)

  const lensAnchor = new THREE.Vector3(0, opticalY, 0.79)
  return { mount, pan, tilt, ledMaterial, lensAnchor }
}

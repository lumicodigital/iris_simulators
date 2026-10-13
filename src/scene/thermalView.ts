import * as THREE from 'three'
import { palettePixels } from '../simulation/thermalPalettes'

export interface HeatSource { object: THREE.Object3D; heat: number }

export function createThermalView(sources: HeatSource[]) {
  const thermalScene = new THREE.Scene()
  thermalScene.background = new THREE.Color().setRGB(0.07, 0.07, 0.07)
  const materials: THREE.ShaderMaterial[] = []
  for (const source of sources) {
    const object = source.object.clone(true)
    object.traverse(child => {
      if (!(child instanceof THREE.Mesh)) return
      const material = new THREE.ShaderMaterial({
        uniforms: { heat: { value: child.userData.heat ?? source.heat } },
        vertexShader: `varying vec3 surfaceNormal; varying vec3 worldPosition;
          void main() {
            vec4 world = modelMatrix * vec4(position, 1.0);
            surfaceNormal = normalize(mat3(modelMatrix) * normal); worldPosition = world.xyz;
            gl_Position = projectionMatrix * viewMatrix * world;
          }`,
        fragmentShader: `uniform float heat; varying vec3 surfaceNormal; varying vec3 worldPosition;
          void main() {
            float detail = 0.012 * sin(worldPosition.x * 2.5 + worldPosition.y * 3.0);
            float value = clamp(heat + detail + 0.035 * dot(normalize(surfaceNormal), normalize(vec3(0.4, 0.8, 0.5))), 0.0, 1.0);
            gl_FragColor = vec4(vec3(value), 1.0);
          }`,
      })
      child.material = material; materials.push(material)
    })
    thermalScene.add(object)
  }
  const target = new THREE.WebGLRenderTarget(280, 158, { depthBuffer: true })
  const data = palettePixels('white-hot')
  const paletteTexture = new THREE.DataTexture(data, 256, 1, THREE.RGBAFormat)
  paletteTexture.minFilter = THREE.LinearFilter; paletteTexture.magFilter = THREE.LinearFilter
  paletteTexture.needsUpdate = true
  const quadMaterial = new THREE.ShaderMaterial({
    uniforms: { heatImage: { value: target.texture }, palette: { value: paletteTexture }, inverted: { value: false } },
    vertexShader: `varying vec2 imageUv; void main() { imageUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: `uniform sampler2D heatImage; uniform sampler2D palette; uniform bool inverted; varying vec2 imageUv;
      void main() {
        float heat = texture2D(heatImage, imageUv).r;
        if (inverted) heat = 1.0 - heat;
        gl_FragColor = vec4(texture2D(palette, vec2(clamp(heat, 0.0, 1.0), 0.5)).rgb, 1.0);
      }`,
    depthTest: false, depthWrite: false,
  })
  const quadScene = new THREE.Scene()
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), quadMaterial)
  quad.frustumCulled = false; quadScene.add(quad)
  const quadCamera = new THREE.Camera()
  const savedViewport = new THREE.Vector4()
  let selectedPalette = 'white-hot'
  return {
    render(renderer: THREE.WebGLRenderer, camera: THREE.Camera, palette: string, inverted: boolean, width: number, height: number) {
      if (palette !== selectedPalette) { data.set(palettePixels(palette)); paletteTexture.needsUpdate = true; selectedPalette = palette }
      quadMaterial.uniforms.inverted.value = inverted
      if (target.width !== width || target.height !== height) target.setSize(width, height)
      const previousTarget = renderer.getRenderTarget()
      const previousScissor = renderer.getScissorTest()
      renderer.getViewport(savedViewport)
      renderer.setRenderTarget(target); renderer.setScissorTest(false)
      renderer.setViewport(0, 0, width, height); renderer.render(thermalScene, camera)
      renderer.setRenderTarget(previousTarget); renderer.setViewport(savedViewport)
      renderer.setScissorTest(previousScissor); renderer.render(quadScene, quadCamera)
    },
    dispose() {
      for (const material of materials) material.dispose()
      target.dispose(); paletteTexture.dispose(); quad.geometry.dispose(); quadMaterial.dispose()
    },
  }
}

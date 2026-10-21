import * as THREE from 'three'

// A planar mirror otherwise sees behind the viewer and around occluders. Test
// reflected fragments against this view's frustum and a compact source depth pass.
export function createReflectionVisibility(scene: THREE.Scene, size: number) {
  const target = new THREE.WebGLRenderTarget(size, size, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter })
  target.depthTexture = new THREE.DepthTexture(size, size, THREE.UnsignedIntType)
  const depth = new THREE.MeshDepthMaterial({ colorWrite: false })
  const uniforms = {
    reflectionVisibilityPass: { value: false },
    reflectionSourceMatrix: { value: new THREE.Matrix4() },
    reflectionSourceDepth: { value: target.depthTexture },
    reflectionSourceFar: { value: 8000 },
    reflectionSourceNear: { value: 0.1 },
    reflectionSourceLogDepth: { value: false },
    reflectionSourcePixelSize: { value: 0.01 },
  }
  const hooks = new Map<THREE.Material, { compile: THREE.Material['onBeforeCompile']; cache: THREE.Material['customProgramCacheKey'] }>()
  const viewport = new THREE.Vector4(); const scissor = new THREE.Vector4()
  const declaration = 'uniform bool reflectionVisibilityPass; uniform mat4 reflectionSourceMatrix; varying vec4 reflectionSourceClip;\n'
  const fragment = `
    uniform sampler2D reflectionSourceDepth;
    uniform float reflectionSourceFar;
    uniform float reflectionSourceNear;
    uniform float reflectionSourcePixelSize;
    uniform bool reflectionSourceLogDepth;
    bool reflectionSourceVisible(vec4 clip, bool sky) {
      if (clip.w <= 0.0 || abs(clip.x) > clip.w || abs(clip.y) > clip.w) return false;
      if (!sky && abs(clip.z) > clip.w) return false;
      float sampled = texture2D(reflectionSourceDepth, clip.xy / clip.w * 0.5 + 0.5).r;
      if (sky) return sampled >= 0.999999;
      float distance = reflectionSourceLogDepth
        ? exp2(sampled * log2(reflectionSourceFar + 1.0)) - 1.0
        : reflectionSourceNear * reflectionSourceFar / (reflectionSourceFar - sampled * (reflectionSourceFar - reflectionSourceNear));
      // A small depth tolerance covers a source pixel's footprint, preventing
      // stippled reflections on sloping hulls and distant building silhouettes.
      return clip.w <= distance + max(0.25, clip.w * reflectionSourcePixelSize * 1.5);
    }
  `
  function prepare(material: THREE.Material) {
    if (hooks.has(material)) return
    const compile = material.onBeforeCompile; const cache = material.customProgramCacheKey
    // Capture the existing key before replacing the callback: Three's default
    // key uses onBeforeCompile.toString(), including the facade atlas hook.
    const key = cache.call(material)
    hooks.set(material, { compile, cache })
    material.customProgramCacheKey = () => `${key}:visible-reflections-v1`
    material.onBeforeCompile = (shader, renderer) => {
      compile.call(material, shader, renderer)
      Object.assign(shader.uniforms, uniforms)
      const sky = material.userData.reflectionSky === true
      const project = sky
        ? 'reflectionSourceClip = reflectionSourceMatrix * vec4(mat3(modelMatrix) * position, 0.0);'
        : `vec4 reflectionPosition = vec4(${shader.vertexShader.includes('#include <project_vertex>') ? 'transformed' : 'position'}, 1.0);
          #ifdef USE_BATCHING
            reflectionPosition = batchingMatrix * reflectionPosition;
          #endif
          #ifdef USE_INSTANCING
            reflectionPosition = instanceMatrix * reflectionPosition;
          #endif
          reflectionSourceClip = reflectionSourceMatrix * modelMatrix * reflectionPosition;`
      shader.vertexShader = declaration + (shader.vertexShader.includes('#include <project_vertex>')
        ? shader.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>\n${project}`)
        : shader.vertexShader.replace(/void main\s*\(\s*\)\s*\{/, match => `${match}\n${project}`))
      shader.fragmentShader = declaration + fragment + shader.fragmentShader.replace(/void main\s*\(\s*\)\s*\{/, match => `${match}\nif (reflectionVisibilityPass && !reflectionSourceVisible(reflectionSourceClip, ${sky ? 'true' : 'false'})) discard;`)
    }
    material.needsUpdate = true
  }
  function setPass(enabled: boolean) {
    uniforms.reflectionVisibilityPass.value = enabled
    for (const material of hooks.keys()) if (material instanceof THREE.ShaderMaterial) material.uniformsNeedUpdate = true
  }
  return {
    begin(renderer: THREE.WebGLRenderer, camera: THREE.Camera) {
      const hidden: THREE.Object3D[] = []
      scene.traverse(object => {
        const drawable = object as THREE.Mesh
        if (!drawable.material) return
        const materials = Array.isArray(drawable.material) ? drawable.material : [drawable.material]
        for (const material of materials) prepare(material)
        // Sky and non-depth-writing overlays must not become opaque occluders
        // when the depth material temporarily replaces their own shaders.
        if (object.visible && materials.every(material => !material.depthWrite || material.userData.reflectionSky)) { hidden.push(object); object.visible = false }
      })
      const previousTarget = renderer.getRenderTarget(); const override = scene.overrideMaterial
      const shadows = renderer.shadowMap.autoUpdate; const scissorTest = renderer.getScissorTest()
      renderer.getViewport(viewport); renderer.getScissor(scissor)
      try {
        scene.overrideMaterial = depth; renderer.shadowMap.autoUpdate = false
        renderer.setRenderTarget(target); renderer.setScissorTest(false)
        // Clear explicitly so this also works with a caller using autoClear=false.
        renderer.clear(); renderer.render(scene, camera)
      } finally {
        scene.overrideMaterial = override; renderer.shadowMap.autoUpdate = shadows
        for (const object of hidden) object.visible = true
        renderer.setRenderTarget(previousTarget)
        if (!previousTarget) { renderer.setViewport(viewport); renderer.setScissor(scissor) }
        renderer.setScissorTest(scissorTest)
      }
      const lens = camera as THREE.PerspectiveCamera
      uniforms.reflectionSourceMatrix.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
      uniforms.reflectionSourceFar.value = lens.far; uniforms.reflectionSourceNear.value = lens.near
      uniforms.reflectionSourceLogDepth.value = renderer.capabilities.logarithmicDepthBuffer
      uniforms.reflectionSourcePixelSize.value = Math.max(2 / Math.abs(camera.projectionMatrix.elements[0]!) / size, 2 / Math.abs(camera.projectionMatrix.elements[5]!) / size)
      setPass(true)
    },
    end() { setPass(false) },
    dispose() {
      for (const [material, hook] of hooks) { material.onBeforeCompile = hook.compile; material.customProgramCacheKey = hook.cache; material.needsUpdate = true }
      hooks.clear(); target.dispose(); depth.dispose()
    },
  }
}

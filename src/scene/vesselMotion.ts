import * as THREE from 'three'
import { sampleOceanWaves } from './ocean'

export function yachtMotion(seconds: number, strength = 1, x = 0, z = 0, yaw = 0) {
  const sample = (side: number, fore: number) => sampleOceanWaves(x + side * Math.cos(yaw) + fore * Math.sin(yaw), z - side * Math.sin(yaw) + fore * Math.cos(yaw), seconds, strength).height
  const fore = sample(0, 18); const aft = sample(0, -18)
  const port = sample(4, 0); const starboard = sample(-4, 0)
  return {
    heave: sample(0, 0) * 0.42,
    pitch: -Math.atan((fore - aft) / 36) * 0.65,
    roll: Math.atan((port - starboard) / 8) * 0.3,
  }
}
const heading = new THREE.Quaternion(); const up = new THREE.Vector3(0, 1, 0)
export function compensateGyro(head: THREE.Object3D, installation: THREE.Object3D, enabled: boolean, referenceHeading: number) {
  head.quaternion.identity()
  if (!enabled) return
  // Keep the optical head level in world space; its mounting foot still follows the hull.
  installation.getWorldQuaternion(head.quaternion).invert()
  heading.setFromAxisAngle(up, referenceHeading); head.quaternion.multiply(heading)
}

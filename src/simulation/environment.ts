export type SceneEnvironment = 'vista' | 'yacht'
export type TimeOfDay = 'day' | 'golden-hour' | 'night'
export const environmentStorageKey = 'iris_simulators_environment_v1'
export const nightStorageKey = 'iris_simulators_night_v1'
export const timeOfDayStorageKey = 'iris_simulators_time_of_day_v1'
export const waveStrengthStorageKey = 'iris_simulators_wave_strength_v1'
export const normalizeWaveStrength = (value: number) => Number.isFinite(value) ? Math.max(0, Math.min(2, value)) : 1
export function loadWaveStrength(): number {
  try { const saved = localStorage.getItem(waveStrengthStorageKey); return saved === null ? 1 : normalizeWaveStrength(Number(saved)) }
  catch { return 1 }
}
export const yachtRenderDistance = 8000

// Metres, with the bow along +Z. Yaw is the installation heading at zero pan.
export const yachtMounts = [
  { id: 'top-forward', name: 'Mast · forward', position: [0, 12.3, -0.6], yaw: 0 },
  { id: 'aft-port', name: 'Aft deck · port', position: [4.6, 5.95, -15.4], yaw: 2.85 },
  { id: 'port', name: 'Port side', position: [5.6, 3.15, 1], yaw: Math.PI / 2 },
  { id: 'starboard', name: 'Starboard side', position: [-5.6, 3.15, 1], yaw: -Math.PI / 2 },
  { id: 'top-aft', name: 'Sun deck · aft', position: [0, 8.6, -8.5], yaw: Math.PI },
  { id: 'aft-starboard', name: 'Aft deck · starboard', position: [-4.6, 5.95, -15.4], yaw: -2.85 },
  { id: 'bow', name: 'Foredeck · bow', position: [0, 3.15, 19], yaw: 0 },
  { id: 'boiler-room', name: 'Boiler room', position: [3.7, -0.95, -7.8], yaw: -Math.PI / 2 },
] as const
export type YachtMountId = typeof yachtMounts[number]['id']
export const isYachtMount = (value: unknown): value is YachtMountId => yachtMounts.some(item => item.id === value)
export function yachtMountFor(camera: { yachtMount?: YachtMountId } | undefined, index = 0) {
  return yachtMounts.find(item => item.id === camera?.yachtMount) ?? yachtMounts[Math.max(0, index) % yachtMounts.length]
}
export function loadEnvironment(): SceneEnvironment {
  try { return localStorage.getItem(environmentStorageKey) === 'yacht' ? 'yacht' : 'vista' }
  catch { return 'vista' }
}
export function loadTimeOfDay(): TimeOfDay {
  try {
    const saved = localStorage.getItem(timeOfDayStorageKey)
    if (saved === 'day' || saved === 'golden-hour' || saved === 'night') return saved
    return localStorage.getItem(nightStorageKey) === 'true' ? 'night' : 'day'
  } catch { return 'day' }
}
export function loadNight(): boolean { return loadTimeOfDay() === 'night' }

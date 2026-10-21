import { reactive } from 'vue'

export interface ThermalSettings { min: number; max: number; air: number; water: number }
export const thermalSettings = reactive<ThermalSettings>({ min: 5, max: 45, air: 20, water: 17 })
export const thermalRanges = [{ name: 'Marine · 5–45°C', min: 5, max: 45 }, { name: 'Machinery · 10–140°C', min: 10, max: 140 }, { name: 'Cold conditions · −10–30°C', min: -10, max: 30 }]
export function setThermalRange(index: number) { const range = thermalRanges[index]; if (range) { thermalSettings.min = range.min; thermalSettings.max = range.max } }
// Existing scene heat tags identify machinery separately from ambient surfaces.
// Temperatures are synthetic Celsius values, not measurements of real equipment.
export function temperatureForHeat(heat: number) {
  return heat <= 0.5 ? 14 + heat * 38 : 33 + (heat - 0.5) * 210
}
export function apparentTemperature(surface: number, reflected: number, air: number, emissivity: number, distance: number) {
  const radiance = (value: number) => (value + 273.15) ** 4
  const transmission = Math.exp(-Math.max(0, distance) * 0.00018)
  const emitted = emissivity * radiance(surface) + (1 - emissivity) * radiance(reflected)
  return (transmission * emitted + (1 - transmission) * radiance(air)) ** 0.25 - 273.15
}

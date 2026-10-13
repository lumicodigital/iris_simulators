export interface ThermalPalette { id: string; name: string; preset: number; stops: [number, string][] }

// Names, preset numbers and colour stops match iris_webapp_vue2/src/color_palletes.js
// and src/index.css. These are IRIS camera commands, not universal Pelco presets.
export const thermalPalettes: ThermalPalette[] = [
  { id: 'white-hot', name: 'White Hot', preset: 201, stops: [[0, '#000000'], [1, '#ffffff']] },
  { id: 'fulgurite', name: 'Fulgurite', preset: 208, stops: [[0, '#030202'], [.3717, '#e03021'], [.7313, '#fffc54'], [.9375, '#fefdaf'], [1, '#fdfef9']] },
  { id: 'iron-red', name: 'Iron Red', preset: 212, stops: [[0, '#06061c'], [.1615, '#1f025c'], [.358, '#951d98'], [.4808, '#da4333'], [.8767, '#ffff58'], [1, '#ffffd0']] },
  { id: 'hot-iron', name: 'Hot Iron', preset: 205, stops: [[0, '#050505'], [.3348, '#407f7c'], [.7516, '#fefd54'], [1, '#d83020']] },
  { id: 'medical', name: 'Medical', preset: 209, stops: [[0, '#39253a'], [.1234, '#cb4dd7'], [.2475, '#1c23ef'], [.3728, '#70ecef'], [.5635, '#49a02e'], [.7285, '#f2f653'], [.7552, '#fffd56'], [.771, '#faef52'], [.8769, '#e94134'], [1, '#ffffff']] },
  { id: 'arctic', name: 'Arctic', preset: 203, stops: [[0, '#0e1c38'], [.1132, '#153fed'], [.2623, '#51ac45'], [.3511, '#83e247'], [.4875, '#f5fd53'], [.6094, '#f1a23a'], [.7612, '#e83a24'], [.8589, '#e934e7'], [1, '#ffffff']] },
  { id: 'rainbow-1', name: 'Rainbow 1', preset: 207, stops: [[0, '#671410'], [.0981, '#cd2da1'], [.1163, '#e432c1'], [.1353, '#ca2ce6'], [.2742, '#1605f4'], [.3819, '#2055f4'], [.493, '#74faf6'], [.6508, '#75fa4f'], [.7551, '#a4fc4e'], [.825, '#fcfd54'], [.8956, '#ef9537'], [1, '#e53523']] },
  { id: 'rainbow-2', name: 'Rainbow 2', preset: 210, stops: [[0, '#01037c'], [.1719, '#153fed'], [.3673, '#76f8fc'], [.6367, '#f7ff56'], [.7204, '#f3ae3d'], [.8656, '#e83324'], [1, '#681814']] },
  { id: 'tint', name: 'Tint', preset: 211, stops: [[0, '#000000'], [.6213, '#f9f9f9'], [1, '#e82215']] },
  { id: 'black-hot', name: 'Black Hot', preset: 202, stops: [[0, '#ffffff'], [1, '#000000']] },
]
export const findPalette = (id: string) => thermalPalettes.find(palette => palette.id === id) ?? thermalPalettes[0]
export const paletteGradient = (id: string) => `linear-gradient(90deg, ${findPalette(id).stops.map(([at, color]) => `${color} ${at * 100}%`).join(', ')})`
export function palettePixels(id: string): Uint8Array {
  const stops = findPalette(id).stops
  const pixels = new Uint8Array(256 * 4)
  const rgb = (hex: string) => [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16))
  for (let index = 0; index < 256; index++) {
    const value = index / 255
    const high = Math.max(1, stops.findIndex(([at]) => at >= value))
    const [lowAt, lowColor] = stops[high - 1]; const [highAt, highColor] = stops[high]
    const fraction = (value - lowAt) / (highAt - lowAt)
    const low = rgb(lowColor); const upper = rgb(highColor)
    for (let channel = 0; channel < 3; channel++) pixels[index * 4 + channel] = Math.round(low[channel] + (upper[channel] - low[channel]) * fraction)
    pixels[index * 4 + 3] = 255
  }
  return pixels
}

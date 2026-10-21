// Every feed, radar contact and parser uses this clock. Playback can therefore
// pause or rewind the world without changing the computer's clock.
let baseNow = Date.now(); let baseSeconds = performance.now() / 1000; let elapsed = 0
export const simulationClock = {
  get now() { return baseNow + elapsed },
  get seconds() { return baseSeconds + elapsed / 1000 },
  advance(milliseconds: number) { elapsed += milliseconds },
  restore(now: number, seconds: number) { baseNow = now; baseSeconds = seconds; elapsed = 0 },
}
export const simulationStep = 1000 / 120

import { hex, type Issue, type StreamEvent } from './pelcoD'

// IRIS nvr.py: AA, key matrix row, key matrix column, press (01) / release (00).
const digits = [[0x25, 0xfb], [0x24, 0xfe], [0x24, 0xfd], [0x24, 0xfb], [0x24, 0xf7], [0x24, 0xef], [0x24, 0xdf], [0x24, 0xbf], [0x24, 0x7f], [0x29, 0xfe]]
export const splitKey = [0x2b, 0xdf] as const
export interface NvrPacket { bytes: number[]; issues: Issue[]; valid: boolean; pressed: boolean; key: string; digit?: number; split: boolean; description: string }
export const nvrFields = ['SYNC', 'KEY A', 'KEY B', 'EVENT']
export function decodeNvr(bytes: number[]): NvrPacket {
  const packet: NvrPacket = { bytes, issues: [], valid: false, pressed: bytes[3] === 1, key: `${hex(bytes[1] ?? 0)}:${hex(bytes[2] ?? 0)}`, split: false, description: 'Invalid NVR packet' }
  const issue = (message: string, indexes: number[]) => packet.issues.push({ severity: 'error', message, bytes: indexes })
  if (bytes.length !== 4) issue(`NVR commands require 4 bytes; received ${bytes.length}.`, bytes.map((_, i) => i))
  if (bytes.some(byte => !Number.isInteger(byte) || byte < 0 || byte > 255)) issue('NVR fields must be bytes in the range 00–FF.', [])
  if (bytes[0] !== 0xaa) issue('NVR sync byte must be AA. This is a separate line from the Pelco-D camera bus.', [0])
  if (bytes[3] !== 0 && bytes[3] !== 1) issue('NVR event must be 01 (press) or 00 (release).', [3])
  const digit = digits.findIndex(([a, b]) => a === bytes[1] && b === bytes[2])
  if (digit >= 0) packet.digit = digit
  packet.split = bytes[1] === splitKey[0] && bytes[2] === splitKey[1]
  packet.description = packet.split ? 'NVR split key' : digit >= 0 ? `NVR numeric key ${digit}` : `NVR key ${packet.key}`
  packet.description += packet.pressed ? ' press' : ' release'
  if (digit < 0 && !packet.split) packet.issues.push({ severity: 'warning', message: `NVR key ${packet.key} is not simulated; its bytes are retained in the capture.`, bytes: [1, 2] })
  packet.valid = !packet.issues.some(item => item.severity === 'error')
  return packet
}
export function makeNvrKey(a: number, b: number): number[] { return [0xaa, a, b, 1, 0xaa, a, b, 0] }
export function makeNvrChannel(channel: number): number[] {
  if (!Number.isInteger(channel) || channel < 0 || channel > 32) throw new Error('NVR channel must be 0–32.')
  const keys = channel < 10 ? [channel] : [Math.floor(channel / 10) - 1, channel % 10]
  return keys.flatMap(key => makeNvrKey(digits[key][0], digits[key][1]))
}
export class NvrStream {
  private buffer: number[] = []
  private lastByteAt = 0
  get pending() { return [...this.buffer] }
  snapshot() { return { buffer: [...this.buffer], lastByteAt: this.lastByteAt } }
  restore(state: { buffer: number[]; lastByteAt: number }) { this.buffer = [...state.buffer]; this.lastByteAt = state.lastByteAt }
  push(bytes: number[], now = Date.now()): StreamEvent[] {
    const events = this.expire(now)
    this.buffer.push(...bytes); this.lastByteAt = now
    while (this.buffer.length) {
      const sync = this.buffer.indexOf(0xaa)
      if (sync !== 0) {
        const noise = this.buffer.splice(0, sync < 0 ? this.buffer.length : sync)
        events.push({ bytes: noise, issue: { severity: 'error', message: `Discarded ${noise.length} byte(s) before NVR AA sync.`, bytes: noise.map((_, i) => i) } })
        continue
      }
      if (this.buffer.length < 4) break
      const candidate = this.buffer.slice(0, 4)
      events.push({ bytes: candidate })
      this.buffer.splice(0, candidate[3] === 0 || candidate[3] === 1 ? 4 : 1)
    }
    return events
  }
  expire(now = Date.now()): StreamEvent[] { return this.buffer.length && now - this.lastByteAt >= 1000 ? this.flush('Incomplete NVR packet: no new bytes for 1 second.') : [] }
  flush(message = 'Incomplete NVR packet at end of input.'): StreamEvent[] {
    const bytes = this.buffer.splice(0)
    return bytes.length ? [{ bytes, issue: { severity: 'error', message, bytes: bytes.map((_, i) => i) } }] : []
  }
}

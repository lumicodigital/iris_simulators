// Pelco D Protocol v5.2.2, sections 3.1, 3.2 and 5.2–5.4.
// https://www.ptzprotocols.com/1%20Pelco%20PTZ%20Protocols/D/DPprotoEPDF.pdf
export type Severity = 'error' | 'warning' | 'info'
export interface Issue { severity: Severity; message: string; bytes: number[] }
export interface Motion {
  pan: number; tilt: number; zoom: number; focus: number; iris: number
  panSpeed: number; tiltSpeed: number; power?: boolean; scan?: boolean
}
export type Command =
  | { type: 'motion'; motion: Motion }
  | { type: 'preset'; action: 'save' | 'clear' | 'call'; preset: number }
  | { type: 'absolute'; axis: 'pan' | 'tilt'; position: number }
  | { type: 'zero' }
  | { type: 'autofocus'; enabled: boolean }
  | { type: 'unsupported'; opcode: number }
export interface Packet {
  bytes: number[]; issues: Issue[]; address: number; checksum: number
  valid: boolean; matches: boolean; description: string; command?: Command
}
export const fields = ['SYNC', 'ADDRESS', 'CMD 1', 'CMD 2', 'DATA 1', 'DATA 2', 'CHECKSUM']
export const hex = (value: number) => value.toString(16).toUpperCase().padStart(2, '0')
export const hexBytes = (bytes: readonly number[]) => bytes.map(hex).join(' ')
export const checksum = (bytes: readonly number[]) => bytes.slice(1, 6).reduce((sum, byte) => sum + byte, 0) & 0xff
export function makePacket(address: number, cmd1 = 0, cmd2 = 0, data1 = 0, data2 = 0): number[] {
  const bytes = [0xff, address, cmd1, cmd2, data1, data2]
  if (bytes.some(byte => !Number.isInteger(byte) || byte < 0 || byte > 255)) throw new Error('Each field must be an integer byte (0–255).')
  return [...bytes, checksum(bytes)]
}
export function parseHex(input: string): number[] {
  const tokens = input.trim().split(/[\s,;:]+/).filter(Boolean)
  if (!tokens.length) throw new Error('Enter at least one hexadecimal byte.')
  if (input.length > 65536) throw new Error('Input is limited to 64 KiB per submission.')
  return tokens.flatMap(token => {
    const clean = token.replace(/^0x/i, '')
    if (!/^(?:[0-9a-fA-F]{2})+$/.test(clean)) throw new Error(`“${token.slice(0, 32)}” is not a complete hex byte. Use pairs such as FF or 0xFF.`)
    return clean.match(/../g)!.map(byte => parseInt(byte, 16))
  })
}
export function decode(bytes: readonly number[], cameraAddress: number, turboByte = 0x40): Packet {
  const packet: Packet = { bytes: [...bytes], issues: [], address: bytes[1] ?? -1, checksum: checksum(bytes), valid: false, matches: bytes[1] === cameraAddress, description: 'Invalid packet' }
  const issue = (severity: Severity, message: string, ...indexes: number[]) => packet.issues.push({ severity, message, bytes: indexes })
  if (bytes.length !== 7) issue('error', `Expected 7 bytes; received ${bytes.length}.`, ...bytes.map((_, index) => index))
  if (bytes.some(byte => !Number.isInteger(byte) || byte < 0 || byte > 255)) issue('error', 'A field is outside the byte range 00–FF.')
  if (bytes[0] !== 0xff) issue('error', 'Sync byte must be FF.', 0)
  if (bytes.length !== 7 || packet.issues.length) return packet
  const [, address, cmd1, cmd2, data1, data2, sentChecksum] = bytes
  if (sentChecksum !== packet.checksum) issue('error', `Checksum ${hex(sentChecksum)} is incorrect; expected ${hex(packet.checksum)} (sum of bytes 2–6 modulo 256).`, 6)
  if (!packet.matches) issue('info', `Address ${address} does not match camera ${cameraAddress}; this camera ignores it.`, 1)
  if (cmd2 & 1) {
    const action = ({ 3: 'save', 5: 'clear', 7: 'call' } as const)[cmd2 as 3 | 5 | 7]
    if (action) {
      if (cmd1 !== 0) issue('error', 'Preset command requires CMD 1 = 00.', 2)
      if (data1 !== 0) issue('error', 'Preset command requires DATA 1 = 00.', 4)
      if (data2 === 0) issue('error', 'Preset number must be 01–FF.', 5)
      packet.command = { type: 'preset', action, preset: data2 }
      packet.description = `${action === 'save' ? 'Save' : action === 'clear' ? 'Clear' : 'Call'} preset ${data2}`
      if (data2 > 32 && data2 !== 33 && data2 !== 34) issue('warning', 'Only presets 1–32 and calls to 33 (flip) / 34 (zero pan) are simulated; other presets may be model-specific.', 5)
      if ((data2 === 33 || data2 === 34) && action !== 'call') issue('warning', 'Presets 33 and 34 are reserved for flip and zero pan in this profile.', 5)
    } else if ([0x49, 0x4b, 0x4d, 0x2b].includes(cmd2)) {
      if (cmd1 !== 0) issue('error', 'This extended command requires CMD 1 = 00.', 2)
      if (cmd2 === 0x49) {
        if (data1 !== 0 || data2 !== 0) issue('error', 'Set zero position requires DATA 1 and DATA 2 = 00.', 4, 5)
        packet.command = { type: 'zero' }; packet.description = 'Set pan display zero'
      } else if (cmd2 === 0x2b) {
        if (data1 !== 0 || data2 > 1) issue('error', 'Auto focus requires DATA 1 = 00, DATA 2 = 00 (auto) or 01 (off).', 4, 5)
        packet.command = { type: 'autofocus', enabled: data2 === 0 }
        packet.description = data2 === 0 ? 'Auto focus on' : 'Auto focus off'
      } else {
        const raw = (data1 << 8) | data2
        if (raw > 35999) issue('error', 'Absolute position must be 0–35999 hundredths of a degree.', 4, 5)
        const position = cmd2 === 0x4b ? raw / 100 : raw <= 18000 ? -raw / 100 : (36000 - raw) / 100
        packet.command = { type: 'absolute', axis: cmd2 === 0x4b ? 'pan' : 'tilt', position }
        packet.description = `Set ${cmd2 === 0x4b ? 'pan' : 'tilt'} to ${position.toFixed(2)}°`
        if (cmd2 === 0x4d && Math.abs(position) > 90) issue('warning', 'Tilt target exceeds this generic camera’s ±90° travel; target will be clamped.', 4, 5)
      }
    } else {
      packet.command = { type: 'unsupported', opcode: cmd2 }
      packet.description = `Extended command ${hex(cmd2)}`
      issue('warning', `Extended opcode ${hex(cmd2)} is not simulated. Its command-specific data has not been validated.`, 2, 3, 4, 5)
    }
  } else {
    if (cmd1 & 0x60) issue('error', 'Reserved CMD 1 bits 5 and 6 must be zero.', 2)
    const conflict = (test: boolean, message: string, ...indexes: number[]) => { if (test) issue('error', message, ...indexes) }
    conflict((cmd2 & 0x06) === 0x06, 'Pan left and right are both set.', 3)
    conflict((cmd2 & 0x18) === 0x18, 'Tilt up and down are both set.', 3)
    conflict((cmd2 & 0x60) === 0x60, 'Zoom tele and wide are both set.', 3)
    conflict(Boolean((cmd1 & 1) && (cmd2 & 0x80)), 'Focus near and far are both set.', 2, 3)
    conflict((cmd1 & 6) === 6, 'Iris open and close are both set.', 2)
    if ((cmd2 & 6) && data1 > 0x3f && data1 !== turboByte) issue('error', `Pan speed must be 00–3F, or ${hex(turboByte)} for turbo (${turboByte === 0xff ? 'legacy IRIS' : 'v5.2.2'} profile).`, 4)
    if ((cmd2 & 0x18) && data2 > 0x3f) issue('error', 'Tilt speed must be 00–3F; tilt has no turbo.', 5)
    if (!(cmd2 & 6) && data1 !== 0) issue('warning', 'Pan speed is ignored because neither pan direction is set.', 4)
    if (!(cmd2 & 0x18) && data2 !== 0) issue('warning', 'Tilt speed is ignored because neither tilt direction is set.', 5)
    if ((cmd1 & 0x80) && !(cmd1 & 0x18)) issue('warning', 'Sense bit has no effect without camera power or scan bits.', 2)
    const motion: Motion = {
      pan: cmd2 & 2 ? 1 : cmd2 & 4 ? -1 : 0,
      tilt: cmd2 & 8 ? 1 : cmd2 & 0x10 ? -1 : 0,
      zoom: cmd2 & 0x20 ? 1 : cmd2 & 0x40 ? -1 : 0,
      focus: cmd1 & 1 ? -1 : cmd2 & 0x80 ? 1 : 0,
      iris: cmd1 & 2 ? 1 : cmd1 & 4 ? -1 : 0,
      panSpeed: data1, tiltSpeed: data2,
      power: cmd1 & 8 ? Boolean(cmd1 & 0x80) : undefined,
      scan: cmd1 & 0x10 ? Boolean(cmd1 & 0x80) : undefined,
    }
    packet.command = { type: 'motion', motion }
    const labels = [motion.pan > 0 ? 'Pan right' : motion.pan < 0 ? 'Pan left' : '', motion.tilt > 0 ? 'Tilt up' : motion.tilt < 0 ? 'Tilt down' : '', motion.zoom > 0 ? 'Zoom tele' : motion.zoom < 0 ? 'Zoom wide' : '', motion.focus < 0 ? 'Focus near' : motion.focus > 0 ? 'Focus far' : '', motion.iris > 0 ? 'Iris open' : motion.iris < 0 ? 'Iris close' : '', motion.power === undefined ? '' : motion.power ? 'Camera on' : 'Camera off', motion.scan === undefined ? '' : motion.scan ? 'Auto scan' : 'Manual scan'].filter(Boolean)
    packet.description = labels.join(' · ') || 'Stop all motion'
  }
  packet.valid = !packet.issues.some(item => item.severity === 'error')
  return packet
}
export interface StreamEvent { bytes: number[]; issue?: Issue }
export class PelcoDStream {
  private buffer: number[] = []
  private lastByteAt = 0
  get pending(): number[] { return [...this.buffer] }
  push(bytes: readonly number[], now = Date.now()): StreamEvent[] {
    const events = this.expire(now)
    this.buffer.push(...bytes)
    this.lastByteAt = now
    while (this.buffer.length) {
      const sync = this.buffer.indexOf(0xff)
      if (sync !== 0) {
        const noise = this.buffer.splice(0, sync < 0 ? this.buffer.length : sync)
        events.push({ bytes: noise, issue: { severity: 'error', message: `Discarded ${noise.length} byte(s) before a valid FF sync byte.`, bytes: noise.map((_, i) => i) } })
        continue
      }
      if (this.buffer.length < 7) break
      const candidate = this.buffer.slice(0, 7)
      events.push({ bytes: candidate })
      if (checksum(candidate) === candidate[6]) this.buffer.splice(0, 7)
      else {
        // Slide to the next possible sync, including FF inside a corrupt frame.
        this.buffer.splice(0, 1)
        const next = this.buffer.indexOf(0xff)
        this.buffer.splice(0, next < 0 ? this.buffer.length : next)
      }
    }
    return events
  }
  expire(now = Date.now()): StreamEvent[] {
    return this.buffer.length && now - this.lastByteAt >= 1000 ? this.flush('Incomplete packet: no new bytes received for 1 second.') : []
  }
  flush(message = 'Incomplete packet at end of input; expected 7 bytes.'): StreamEvent[] {
    if (!this.buffer.length) return []
    const bytes = this.buffer.splice(0)
    return [{ bytes, issue: { severity: 'error', message, bytes: bytes.map((_, i) => i) } }]
  }
}

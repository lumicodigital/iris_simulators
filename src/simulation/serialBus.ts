import { decode, PelcoDStream, type Issue, type Packet, type StreamEvent } from '../protocol/pelcoD'
import { applyPacket, type CameraState } from './camera'
import type { Switcher } from './switcher'
import type { SimulatedCamera } from './cameras'

export interface BusSettings { cameraAddress: number; cameraBaudRate: number; baudRate: number; turboByte: number; cameras?: readonly SimulatedCamera[] }
export interface Delivery { id: string; name: string; kind: 'camera' | 'switcher'; address: number; result: string; detail: string }
export interface BusResult { packet: Packet; result: string; deliveries: Delivery[] }
export interface BusDiagnostic { severity: 'warning' | 'info'; message: string }
export function busDiagnostics(settings: BusSettings, switches: readonly Switcher[]): BusDiagnostic[] {
  const devices = [...(settings.cameras ?? [{ name: 'PTZ camera', address: settings.cameraAddress, baudRate: settings.cameraBaudRate }]), ...switches.filter(device => device.enabled)]
  const diagnostics: BusDiagnostic[] = []
  const addresses = new Map<number, string[]>()
  for (const device of devices) {
    addresses.set(device.address, [...(addresses.get(device.address) ?? []), device.name])
    if (device.baudRate !== settings.baudRate) diagnostics.push({ severity: 'warning', message: `${device.name} expects ${device.baudRate} baud; the shared bus is ${settings.baudRate}. It will not decode the traffic.` })
  }
  for (const [address, names] of addresses) if (names.length > 1) diagnostics.push({ severity: 'warning', message: `Address conflict at ${address}: ${names.join(', ')}. Each matching device receives the same packet.` })
  return diagnostics
}
export function dispatchPacket(bytes: number[], camera: CameraState | readonly SimulatedCamera[], switches: Switcher[], settings: BusSettings, now = Date.now()): BusResult {
  // Validate a bus frame independently of whichever simulator is currently visible.
  const packet = decode(bytes, bytes[1] ?? -1, settings.turboByte)
  const cameras = 'pan' in camera ? [{ id: 'camera', name: 'PTZ camera', address: settings.cameraAddress, baudRate: settings.cameraBaudRate, state: camera }] : camera
  const devices = [...cameras.map(device => ({ ...device, kind: 'camera' as const, enabled: true })), ...switches.map(device => ({ ...device, kind: 'switcher' as const }))]
  const listeners = devices.filter(device => device.enabled && device.address === packet.address)
  const deliveries: Delivery[] = []
  const originalDescription = packet.description
  let handled = 0; let rejected = 0
  if (listeners.length > 1) packet.issues.push({ severity: 'warning', message: `Address ${packet.address} is used by ${listeners.map(device => device.name).join(', ')}; delivery is ambiguous. All matching devices are evaluated.`, bytes: [1] })
  for (const device of devices) {
    const delivery: Delivery = { id: device.id, name: device.name, kind: device.kind, address: device.address, result: 'Address filtered', detail: `Listens at ${device.address}` }
    if (!device.enabled) { delivery.result = 'Disabled'; delivery.detail = 'Removed from the receiving bus' }
    else if (device.address !== packet.address) { /* Address filtering is performed before opcode handling. */ }
    else if (!packet.valid) { delivery.result = 'Rejected'; delivery.detail = 'Invalid bytes, checksum, or command fields' }
    else if (device.baudRate !== settings.baudRate) {
      delivery.result = 'Baud mismatch'; delivery.detail = `${device.baudRate} baud ≠ ${settings.baudRate} baud`
      packet.issues.push({ severity: 'warning', message: `${device.name} cannot decode this bus baud rate.`, bytes: [1] })
    } else if (device.kind === 'camera') {
      const copy: Packet = { ...packet, description: originalDescription, matches: true, issues: [...packet.issues] }
      delivery.result = applyPacket(device.state, copy, now)
      delivery.detail = copy.description
      packet.issues.push(...copy.issues.slice(packet.issues.length))
      if (!['Not simulated', 'Ignored opcode', 'No preset'].includes(delivery.result)) { handled++; packet.description = copy.description }
    } else if (packet.command?.type !== 'route') {
      delivery.result = 'Ignored opcode'; delivery.detail = 'Switcher only handles IRIS routing opcode 0D'
    } else {
      const { output, input } = packet.command
      const target = switches.find(item => item.id === device.id)!
      const errors: Issue[] = []
      if (output > target.outputs.length) errors.push({ severity: 'error', message: `${target.name}: output ${output} is not configured (1–${target.outputs.length}).`, bytes: [4] })
      if (input > target.inputs.length) errors.push({ severity: 'error', message: `${target.name}: input ${input} is not configured (1–${target.inputs.length}).`, bytes: [5] })
      if (errors.length) { delivery.result = 'Rejected'; delivery.detail = 'Port outside the configured switcher'; packet.issues.push(...errors); rejected++ }
      else {
        target.routes[output] = input; target.updatedAt = now
        delivery.result = 'Routed'; delivery.detail = `${target.inputs[input - 1]} → ${target.outputs[output - 1]}`
        handled++
      }
    }
    deliveries.push(delivery)
  }
  packet.matches = listeners.length > 0
  if (!listeners.length) packet.issues.push({ severity: 'info', message: `No enabled simulator listens at address ${packet.address}; all devices ignore the packet.`, bytes: [1] })
  const validFrame = packet.valid
  packet.valid = packet.valid && !packet.issues.some(issue => issue.severity === 'error')
  const result = !validFrame ? 'Rejected' : listeners.length > 1 ? 'Address conflict' : rejected ? 'Rejected' : handled ? packet.command?.type === 'route' ? 'Routed' : deliveries.find(item => item.kind === 'camera' && item.address === packet.address)?.result ?? 'Applied' : listeners.length ? 'Ignored' : 'No device'
  return { packet, result, deliveries }
}
export interface BusStreamEvent extends StreamEvent { source: string }
export class SharedSerialBus {
  private stream = new PelcoDStream()
  private source = ''
  get pending() { return this.stream.pending }
  receive(bytes: number[], source: string, complete = false, now = Date.now()): BusStreamEvent[] {
    const events: BusStreamEvent[] = this.expire(now)
    if (this.stream.pending.length && this.source && this.source !== source) {
      const pending = this.stream.pending
      events.push({ source, bytes: pending, issue: { severity: 'warning', message: `${source} inserted bytes into an incomplete packet from ${this.source}. These bytes share the same parser and can corrupt each other.`, bytes: pending.map((_, index) => index) } })
    }
    this.source = source
    events.push(...this.stream.push(bytes, now).map(event => ({ ...event, source })))
    if (complete) events.push(...this.flush('Incomplete packet at end of injected input.'))
    return events
  }
  expire(now = Date.now()): BusStreamEvent[] { return this.stream.expire(now).map(event => ({ ...event, source: this.source || 'bus' })) }
  flush(message: string): BusStreamEvent[] { return this.stream.flush(message).map(event => ({ ...event, source: this.source || 'bus' })) }
}

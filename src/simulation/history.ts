import type { Issue, Packet } from '../protocol/pelcoD'
import type { Delivery } from './serialBus'

export interface CaptureEntry { id: number; time: string; source: string; bytes: number[]; issues: Issue[]; packet?: Packet; description: string; result: string; deliveries: Delivery[]; protocol?: 'nvr' }
export function isAppliedDelivery(delivery: Delivery) { return ['Applied', 'Saved', 'Cleared', 'Lamp armed', 'Routed'].includes(delivery.result) }
export function pelcoAddress(entry: CaptureEntry): number | undefined {
  if (entry.protocol === 'nvr' || entry.bytes[0] !== 0xff) return
  const address = entry.packet?.address ?? entry.bytes[1]
  return Number.isInteger(address) && address >= 1 && address <= 255 ? address : undefined
}
export function cameraHistory(entries: readonly CaptureEntry[], address: number) { return entries.filter(entry => pelcoAddress(entry) === address) }
export function captureSummary(entries: readonly CaptureEntry[]) {
  return {
    bytes: entries.reduce((sum, entry) => sum + entry.bytes.length, 0),
    frames: entries.filter(entry => entry.packet || entry.protocol === 'nvr' && entry.bytes.length === 4 && entry.bytes[0] === 0xaa).length,
    rejected: entries.filter(entry => entry.result === 'Rejected' || entry.deliveries.some(item => item.result === 'Rejected')).length,
  }
}

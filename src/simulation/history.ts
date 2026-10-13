import type { Issue, Packet } from '../protocol/pelcoD'
import type { Delivery } from './serialBus'

export interface CaptureEntry { id: number; time: string; source: string; bytes: number[]; issues: Issue[]; packet?: Packet; description: string; result: string; deliveries: Delivery[]; protocol?: 'nvr' }
export function isAppliedDelivery(delivery: Delivery) { return ['Applied', 'Saved', 'Cleared', 'Lamp armed', 'Routed'].includes(delivery.result) }

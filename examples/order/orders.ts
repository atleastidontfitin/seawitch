import type { Order, Receipt } from './types.js';

type Calls = {
  expedited: number;
  standard: number;
  receipt: number;
};

const callsKey = Symbol.for('seawitch.order.calls');

function calls(): Calls {
  const target = globalThis as typeof globalThis & { [callsKey]?: Calls };
  return (target[callsKey] ??= { expedited: 0, standard: 0, receipt: 0 });
}

export function resetOrderCalls(): void {
  const current = calls();
  current.expedited = 0;
  current.standard = 0;
  current.receipt = 0;
}

export function orderCalls(): Calls {
  return { ...calls() };
}

export function normalize(order: Order): Order {
  return {
    id: order.id.trim(),
    expedited: order.expedited,
    items: order.items,
  };
}

export function isExpedited(order: Order): boolean {
  return order.expedited;
}

export function noteExpedited(order: Order): Order {
  calls().expedited += 1;
  return order;
}

export function noteStandard(order: Order): Order {
  calls().standard += 1;
  return order;
}

export function receiptFor(order: Order, expedited: boolean): Receipt {
  calls().receipt += 1;
  return {
    orderId: order.id,
    total: order.items * (expedited ? 3 : 2),
    copy: expedited ? 'expedited' : 'standard',
  };
}

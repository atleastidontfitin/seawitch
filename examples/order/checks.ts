import type { Order } from './types.js';

export function asText(order: Order): string {
  return order.id;
}

export function asAny(order: Order): any {
  return order.expedited;
}

export function asUnknown(order: Order): unknown {
  return order.expedited;
}

export function asNullable(order: Order): boolean | null {
  return order.expedited ? true : null;
}

export function alwaysExpedited(_order: Order): true {
  return true;
}

export function ident<T>(value: T): T {
  return value;
}

export function overloaded(value: Order): Order;
export function overloaded(value: string): Order;
export function overloaded(value: Order | string): Order {
  return typeof value === 'string' ? { id: value, expedited: false, items: 0 } : value;
}

export function joinLabels(order: Order, ..._parts: string[]): Order {
  return order;
}

export async function later(order: Order): Promise<Order> {
  return order;
}

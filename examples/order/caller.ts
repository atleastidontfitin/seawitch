import { fulfillOrder } from '../../generated/fulfillOrder.js';
import type { Order, Receipt } from './types.js';

export function callFulfillOrder(order: Order): Receipt {
  return fulfillOrder(order);
}

import { classifyNumber } from '../../generated/classifyNumber.js';
import { describeNumber } from '../../generated/describeNumber.js';
import type { Classification } from './types.js';

export function callClassifyNumber(value: number): Classification {
  return classifyNumber(value);
}

export function callDescribeNumber(value: number): Classification {
  return describeNumber(value);
}

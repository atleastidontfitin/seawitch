import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { renderMermaid } from './renderMermaid.js';

const classifyNumber = path.join(import.meta.dirname, '../examples/classifyNumber/classifyNumber.sea.mmd');
const fulfillOrder = path.join(import.meta.dirname, '../examples/order/fulfillOrder.sea.mmd');

test('unchanged classifyNumber source renders in Mermaid', async () => {
  const source = readFileSync(classifyNumber, 'utf8');
  const svg = await renderMermaid(source, 'seawitch-classify-number');
  for (const label of ['start', 'isNegative', 'isZero', 'negative', 'zero', 'positive']) {
    assert.equal(svg.includes(label), true, `rendered diagram is missing ${label}`);
  }
});

test('fulfillOrder join renders in unmodified Mermaid', async () => {
  const source = readFileSync(fulfillOrder, 'utf8');
  const svg = await renderMermaid(source, 'seawitch-fulfill-order');
  for (const label of ['normalize', 'isExpedited', 'noteExpedited', 'noteStandard', 'receiptFor']) {
    assert.equal(svg.includes(label), true, `rendered diagram is missing ${label}`);
  }
});

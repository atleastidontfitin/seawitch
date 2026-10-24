import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { renderMermaid } from './renderMermaid.js';

const fixture = path.join(import.meta.dirname, '../examples/classifyNumber/classifyNumber.sea.mmd');

test('unchanged classifyNumber source renders in Mermaid', async () => {
  const source = readFileSync(fixture, 'utf8');
  const svg = await renderMermaid(source, 'seawitch-classify-number');
  for (const label of ['start', 'isNegative', 'isZero', 'negative', 'zero', 'positive']) {
    assert.equal(svg.includes(label), true, `rendered diagram is missing ${label}`);
  }
});

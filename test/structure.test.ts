import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, test } from 'node:test';
import { compile } from '../src/compile.js';

const marksSource = `import type { Order } from './types.js';

type Marks = { fast: number; slow: number; predicate: number; inner: number };
const key = Symbol.for('seawitch.structure.marks');

function marks(): Marks {
  const target = globalThis as typeof globalThis & { [key]?: Marks };
  return (target[key] ??= { fast: 0, slow: 0, predicate: 0, inner: 0 });
}

export function resetMarks(): void {
  const current = marks();
  current.fast = 0;
  current.slow = 0;
  current.predicate = 0;
  current.inner = 0;
}

export function markCounts(): Marks {
  return { ...marks() };
}

export function isFast(order: Order): boolean {
  marks().predicate += 1;
  return order.expedited;
}

export function hasItems(order: Order): boolean {
  marks().inner += 1;
  return order.items > 1;
}

export function markFast(order: Order): Order {
  marks().fast += 1;
  return order;
}

export function markSlow(order: Order): Order {
  marks().slow += 1;
  return order;
}

export function stamp(order: Order): Order {
  return { ...order, items: order.items + 1 };
}

export function slowName(order: Order): string {
  marks().slow += 1;
  return order.id + ':slow';
}
`;

function stage(): { src: string; out: string } {
  const root = mkdtempSync(path.join(tmpdir(), 'seawitch-structure-'));
  const src = path.join(root, 'examples', 'order');
  mkdirSync(src, { recursive: true });
  writeFileSync(path.join(root, 'package.json'), '{ "type": "module" }\n');
  writeFileSync(path.join(src, 'types.ts'), "export type Order = { id: string; expedited: boolean; items: number };\n");
  writeFileSync(path.join(src, 'marks.ts'), marksSource);
  return { src, out: path.join(root, 'generated') };
}

function countOf(text: string, fragment: string): number {
  return text.split(fragment).length - 1;
}

function diamondChain(levels: number, name: string): string {
  const lines = [
    'flowchart TD',
    `    %% seawitch: function ${name}(order: Order): Order`,
    '    %% seawitch: import type { Order } from "./types.js"',
    '    %% seawitch: import { isFast, markFast, markSlow, stamp } from "./marks.js"',
    '    start["start"] --> current["call stamp(order)"]',
  ];
  let previous = 'current';
  for (let level = 1; level <= levels; level += 1) {
    lines.push(`    ${previous} --> d${level}{"call isFast(${previous})"}`);
    lines.push(`    d${level} -->|true| a${level}["call markFast(${previous})"]`);
    lines.push(`    d${level} -->|false| b${level}["call markSlow(${previous})"]`);
    lines.push(`    a${level} --> j${level}["call stamp(${previous})"]`);
    lines.push(`    b${level} --> j${level}`);
    previous = `j${level}`;
  }
  lines.push(`    ${previous} --> done["return ${previous}"]`);
  return `${lines.join('\n')}\n`;
}

function crossingCascade(levels: number): string {
  const lines = [
    'flowchart TD',
    '    %% seawitch: function cascade(order: Order): string',
    '    %% seawitch: import type { Order } from "./types.js"',
    '    %% seawitch: import { isFast } from "./marks.js"',
    '    start["start"] --> d1{"call isFast(order)"}',
    '    d1 -->|true| a2{"call isFast(order)"}',
    '    d1 -->|false| b2{"call isFast(order)"}',
  ];
  for (let level = 2; level < levels; level += 1) {
    lines.push(`    a${level} -->|true| a${level + 1}{"call isFast(order)"}`);
    lines.push(`    a${level} -->|false| b${level + 1}{"call isFast(order)"}`);
    lines.push(`    b${level} -->|true| a${level + 1}`);
    lines.push(`    b${level} -->|false| b${level + 1}`);
  }
  lines.push(`    a${levels} -->|true| yes["return 'yes'"]`);
  lines.push(`    a${levels} -->|false| no["return 'no'"]`);
  lines.push(`    b${levels} -->|true| yes`);
  lines.push(`    b${levels} -->|false| no`);
  return `${lines.join('\n')}\n`;
}

describe('structured emission', { concurrency: 1 }, () => {
  test('sequential decision diamonds grow linearly and each call runs once', async () => {
    const staged = stage();
    const marks = await import(pathToFileURL(path.join(staged.src, 'marks.ts')).href);
    const linesByLevels: number[] = [];
    for (const levels of [5, 10, 20, 50]) {
      const name = `chain${levels}`;
      writeFileSync(path.join(staged.src, `${name}.sea.mmd`), diamondChain(levels, name));
      const result = compile({
        entries: [path.join(staged.src, `${name}.sea.mmd`)],
        srcRoot: staged.src,
        outRoot: staged.out,
      });
      assert.deepEqual(result.diagnostics, []);
      const generated = result.outputs[0]?.contents ?? '';
      assert.equal(countOf(generated, 'markFast('), levels);
      assert.equal(countOf(generated, 'markSlow('), levels);
      assert.equal(countOf(generated, 'stamp('), levels + 1);
      assert.equal(generated.includes('while ('), false);
      assert.equal(generated.includes('switch ('), false);
      const lines = generated.split('\n').length;
      assert.ok(lines <= levels * 8 + 40, `chain of ${levels} emitted ${lines} lines`);
      linesByLevels.push(lines);

      const imported = await import(pathToFileURL(path.join(staged.out, `${name}.ts`)).href);
      marks.resetMarks();
      assert.deepEqual(imported[name]({ id: ' a ', expedited: true, items: 1 }), {
        id: ' a ',
        expedited: true,
        items: levels + 2,
      });
      assert.deepEqual(marks.markCounts(), { fast: levels, slow: 0, predicate: levels, inner: 0 });
      marks.resetMarks();
      assert.deepEqual(imported[name]({ id: 'b', expedited: false, items: 4 }), {
        id: 'b',
        expedited: false,
        items: levels + 5,
      });
      assert.deepEqual(marks.markCounts(), { fast: 0, slow: levels, predicate: levels, inner: 0 });
    }
    const shortest = linesByLevels[0] ?? 1;
    const longest = linesByLevels[3] ?? 0;
    assert.ok(longest / shortest < 20, `line counts ${linesByLevels.join(', ')} are not linear`);
  });

  test('a nested decision joins once, and an early return skips the other arm', async () => {
    const staged = stage();
    writeFileSync(
      path.join(staged.src, 'nested.sea.mmd'),
      `flowchart TD
    %% seawitch: function nested(order: Order): Order
    %% seawitch: import type { Order } from "./types.js"
    %% seawitch: import { isFast, hasItems, markFast, markSlow, stamp } from "./marks.js"
    start["start"] --> gate{"call isFast(order)"}
    gate -->|true| inner{"call hasItems(order)"}
    gate -->|false| regular["call markSlow(order)"]
    inner -->|true| fast["call markFast(order)"]
    inner -->|false| small["call markSlow(order)"]
    fast --> done["call stamp(order)"]
    small --> done
    regular --> done
    done --> ret["return done"]
`,
    );
    writeFileSync(
      path.join(staged.src, 'early.sea.mmd'),
      `flowchart TD
    %% seawitch: function leave(order: Order): string
    %% seawitch: import type { Order } from "./types.js"
    %% seawitch: import { isFast, slowName } from "./marks.js"
    start["start"] --> gate{"call isFast(order)"}
    gate -->|true| early["return 'early'"]
    gate -->|false| named["call slowName(order)"]
    named --> later["return named"]
`,
    );
    const result = compile({
      entries: [path.join(staged.src, 'nested.sea.mmd'), path.join(staged.src, 'early.sea.mmd')],
      srcRoot: staged.src,
      outRoot: staged.out,
    });
    assert.deepEqual(result.diagnostics, []);
    const nested = result.outputs.find((output) => output.path.endsWith('nested.ts'))?.contents ?? '';
    const early = result.outputs.find((output) => output.path.endsWith('early.ts'))?.contents ?? '';
    assert.equal(countOf(nested, 'stamp('), 1);
    assert.equal(countOf(nested, 'markFast('), 1);
    assert.match(nested, /if \(isFast\(order\)\) \{\s*if \(hasItems\(order\)\) \{/);
    assert.equal(countOf(early, 'slowName('), 1);
    assert.match(early, /if \(isFast\(order\)\) \{\s*return 'early';\s*\} else \{\s*const named = slowName\(order\);\s*return named;\s*\}/);

    const marks = await import(pathToFileURL(path.join(staged.src, 'marks.ts')).href);
    const nestedFn = await import(pathToFileURL(path.join(staged.out, 'nested.ts')).href);
    marks.resetMarks();
    assert.deepEqual(nestedFn.nested({ id: 'a', expedited: true, items: 3 }), {
      id: 'a',
      expedited: true,
      items: 4,
    });
    assert.deepEqual(marks.markCounts(), { fast: 1, slow: 0, predicate: 1, inner: 1 });
    marks.resetMarks();
    assert.deepEqual(nestedFn.nested({ id: 'a', expedited: true, items: 1 }), {
      id: 'a',
      expedited: true,
      items: 2,
    });
    assert.deepEqual(marks.markCounts(), { fast: 0, slow: 1, predicate: 1, inner: 1 });
    marks.resetMarks();
    assert.deepEqual(nestedFn.nested({ id: 'a', expedited: false, items: 3 }), {
      id: 'a',
      expedited: false,
      items: 4,
    });
    assert.deepEqual(marks.markCounts(), { fast: 0, slow: 1, predicate: 1, inner: 0 });

    const earlyFn = await import(pathToFileURL(path.join(staged.out, 'early.ts')).href);
    marks.resetMarks();
    assert.equal(earlyFn.leave({ id: 'a', expedited: true, items: 1 }), 'early');
    assert.deepEqual(marks.markCounts(), { fast: 0, slow: 0, predicate: 1, inner: 0 });
    marks.resetMarks();
    assert.equal(earlyFn.leave({ id: 'b', expedited: false, items: 1 }), 'b:slow');
    assert.deepEqual(marks.markCounts(), { fast: 0, slow: 1, predicate: 1, inner: 0 });
  });

  test('both arms of a decision may share their target without an empty conditional', async () => {
    const staged = stage();
    writeFileSync(
      path.join(staged.src, 'same.sea.mmd'),
      `flowchart TD
    %% seawitch: function same(order: Order): Order
    %% seawitch: import type { Order } from "./types.js"
    %% seawitch: import { isFast, stamp } from "./marks.js"
    start["start"] --> gate{"call isFast(order)"}
    gate -->|true| done["call stamp(order)"]
    gate -->|false| done
    done --> ret["return done"]
`,
    );
    const result = compile({
      entries: [path.join(staged.src, 'same.sea.mmd')],
      srcRoot: staged.src,
      outRoot: staged.out,
    });
    assert.deepEqual(result.diagnostics, []);
    const generated = result.outputs[0]?.contents ?? '';
    assert.equal(generated.includes('if ('), false);
    assert.equal(countOf(generated, 'isFast('), 1);
    assert.equal(countOf(generated, 'stamp('), 1);
    const marks = await import(pathToFileURL(path.join(staged.src, 'marks.ts')).href);
    const imported = await import(pathToFileURL(path.join(staged.out, 'same.ts')).href);
    marks.resetMarks();
    assert.deepEqual(imported.same({ id: 'a', expedited: true, items: 1 }), {
      id: 'a',
      expedited: true,
      items: 2,
    });
    assert.equal(marks.markCounts().predicate, 1);
  });

  test('a crossing pair duplicates the unsplittable node and still runs it once', async () => {
    const staged = stage();
    writeFileSync(
      path.join(staged.src, 'cross.sea.mmd'),
      `flowchart TD
    %% seawitch: function cross(order: Order): string
    %% seawitch: import type { Order } from "./types.js"
    %% seawitch: import { isFast, hasItems, markFast, markSlow } from "./marks.js"
    start["start"] --> outer{"call isFast(order)"}
    outer -->|true| left["call markFast(order)"]
    outer -->|false| inner{"call hasItems(order)"}
    inner -->|true| left
    inner -->|false| right["call markSlow(order)"]
    left --> yes["return 'left'"]
    right --> no["return 'right'"]
`,
    );
    const result = compile({
      entries: [path.join(staged.src, 'cross.sea.mmd')],
      srcRoot: staged.src,
      outRoot: staged.out,
    });
    assert.deepEqual(result.diagnostics, []);
    const generated = result.outputs[0]?.contents ?? '';
    assert.equal(countOf(generated, 'markFast('), 2);
    assert.equal(countOf(generated, "return 'left';"), 2);
    const marks = await import(pathToFileURL(path.join(staged.src, 'marks.ts')).href);
    const imported = await import(pathToFileURL(path.join(staged.out, 'cross.ts')).href);
    marks.resetMarks();
    assert.equal(imported.cross({ id: 'a', expedited: true, items: 1 }), 'left');
    assert.deepEqual(marks.markCounts(), { fast: 1, slow: 0, predicate: 1, inner: 0 });
    marks.resetMarks();
    assert.equal(imported.cross({ id: 'a', expedited: false, items: 3 }), 'left');
    assert.deepEqual(marks.markCounts(), { fast: 1, slow: 0, predicate: 1, inner: 1 });
    marks.resetMarks();
    assert.equal(imported.cross({ id: 'a', expedited: false, items: 1 }), 'right');
    assert.deepEqual(marks.markCounts(), { fast: 0, slow: 1, predicate: 1, inner: 1 });
  });

  test('a cascade of crossing decisions stops at the expansion guard', () => {
    const staged = stage();
    writeFileSync(path.join(staged.src, 'cascade.sea.mmd'), crossingCascade(12));
    const result = compile({
      entries: [path.join(staged.src, 'cascade.sea.mmd')],
      srcRoot: staged.src,
      outRoot: staged.out,
    });
    assert.equal(result.outputs.length, 0);
    assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === 'SW103'));
  });
});

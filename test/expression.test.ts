import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { compile } from '../src/compile.js';
import { renderMermaid } from './renderMermaid.js';

const repoRoot = path.join(import.meta.dirname, '..');

function stage(): { root: string; src: string; out: string } {
  const root = mkdtempSync(path.join(tmpdir(), 'seawitch-expr-'));
  const src = path.join(root, 'src');
  mkdirSync(src);
  writeFileSync(path.join(root, 'package.json'), '{ "type": "module" }\n');
  writeFileSync(
    path.join(src, 'types.ts'),
    `export type Sample = { window: 'late' | 'open'; leaf: string; value: number; supports: boolean };\n`,
  );
  writeFileSync(
    path.join(src, 'checks.ts'),
    `const calls: string[] = [];
export function reset(): void { calls.length = 0; }
export function seen(): string[] { return calls.slice(); }
export function left(value: number): boolean { calls.push('left'); return value < 0; }
export function right(value: number): boolean { calls.push('right'); return true; }
export function bump(value: number): string { calls.push('bump'); return 'yes'; }
`,
  );
  return { root, src, out: path.join(root, 'generated') };
}

function compileGraph(source: string, name = 'graph.sea.mmd') {
  const staged = stage();
  writeFileSync(path.join(staged.src, name), source);
  const result = compile({
    entries: [path.join(staged.src, name)],
    srcRoot: staged.src,
    outRoot: staged.out,
  });
  return { staged, result };
}

const base = `flowchart TD
    %% seawitch: function classify(sample: Sample): string
    %% seawitch: import type { Sample } from "./types.js"
    %% seawitch: import { left, right, bump } from "./checks.js"
`;

test('an expression decision, a call, and a property read execute', async () => {
  const { staged, result } = compileGraph(`${base}
    start["start"] --> negative{"left(sample.value) && right(sample.value)"}
    negative -->|true| bumped["bump(sample.value)"]
    bumped --> yes["return bumped"]
    negative -->|false| no["return 'no'"]
`);
  assert.deepEqual(result.diagnostics, []);
  const generated = result.outputs[0]?.contents ?? '';
  assert.match(generated, /if \(\(left\(sample\.value\) && right\(sample\.value\)\)\)/);
  assert.equal(/^\s+\/\//m.test(generated), false);
  assert.equal(generated.includes('while ('), false);

  const checks = await import(pathToFileURL(path.join(staged.src, 'checks.ts')).href);
  const imported = await import(pathToFileURL(path.join(staged.out, 'graph.ts')).href);
  checks.reset();
  assert.equal(imported.classify({ window: 'open', leaf: 'x', value: 4, supports: true }), 'no');
  assert.deepEqual(checks.seen(), ['left']);
  checks.reset();
  assert.equal(imported.classify({ window: 'open', leaf: 'x', value: -2, supports: true }), 'yes');
  assert.deepEqual(checks.seen(), ['left', 'right', 'bump']);
});

test('a property comparison and a field read use the label text', async () => {
  const { staged, result } = compileGraph(`flowchart TD
    %% seawitch: function describe(sample: Sample): string
    %% seawitch: import type { Sample } from "./types.js"
    start["start"] --> late{"sample.window === 'late'"}
    late -->|true| closed["return 'closed'"]
    late -->|false| leaf["sample.leaf"]
    leaf --> open["return leaf"]
`);
  assert.deepEqual(result.diagnostics, []);
  const imported = await import(pathToFileURL(path.join(staged.out, 'graph.ts')).href);
  assert.equal(imported.describe({ window: 'late', leaf: 'strong', value: 0, supports: true }), 'closed');
  assert.equal(imported.describe({ window: 'open', leaf: 'consider', value: 0, supports: true }), 'consider');
});

test('editing the label changes the executed condition', () => {
  const first = compileGraph(`${base}
    start["start"] --> negative{"sample.value < 0"}
    negative -->|true| yes["return 'yes'"]
    negative -->|false| no["return 'no'"]
`);
  const second = compileGraph(`${base}
    start["start"] --> negative{"sample.value !== 0"}
    negative -->|true| yes["return 'yes'"]
    negative -->|false| no["return 'no'"]
`);
  assert.deepEqual(first.result.diagnostics, []);
  assert.deepEqual(second.result.diagnostics, []);
  assert.match(first.result.outputs[0]?.contents ?? '', /sample\.value < 0/);
  assert.match(second.result.outputs[0]?.contents ?? '', /sample\.value !== 0/);
  assert.equal((first.result.outputs[0]?.contents ?? '').includes('sample.value !== 0'), false);
});

test('compiling the same expression graph twice emits identical text', () => {
  const source = `${base}
    start["start"] --> negative{"sample.value === 0"}
    negative -->|true| yes["return 'yes'"]
    negative -->|false| no["return 'no'"]
`;
  const first = compileGraph(source);
  const second = compileGraph(source);
  assert.deepEqual(first.result.diagnostics, []);
  assert.equal(first.result.outputs[0]?.contents, second.result.outputs[0]?.contents);
});

test('legacy classifyNumber output has no display comments', () => {
  const out = mkdtempSync(path.join(tmpdir(), 'seawitch-legacy-'));
  const result = compile({
    entries: [path.join(repoRoot, 'examples/classifyNumber/classifyNumber.sea.mmd')],
    srcRoot: path.join(repoRoot, 'examples/classifyNumber'),
    outRoot: out,
  });
  assert.deepEqual(result.diagnostics, []);
  const generated = result.outputs[0]?.contents ?? '';
  assert.equal(/^\s+\/\//m.test(generated), false);
  assert.match(generated, /if \(isNegative\(value\)\)/);
});

test('a decide directive is rejected as an unknown directive', () => {
  const { result } = compileGraph(`flowchart TD
    %% seawitch: function bad(sample: Sample): string
    %% seawitch: import type { Sample } from "./types.js"
    %% seawitch: decide late sample.window === 'late'
    start["start"] --> late{"sample.window === 'late'"}
    late -->|true| closed["return 'closed'"]
    late -->|false| open["return 'open'"]
`);
  assert.equal(result.diagnostics.some((item) => item.code === 'SW012'), true);
  assert.equal(result.outputs.length, 0);
});

test('loose equality, mutation, and other excluded expressions are rejected', () => {
  const cases = [
    ["sample.value == 1", /===/],
    ["sample.value != 1", /===/],
    ["sample.value = 1", /operator/i],
    ["sample.value === 1 ? true : false", /decision node/],
    ["sample.leaf!.length === 1", /Non-null/],
    ["sample.supports as boolean", /Type assertions/],
    ["{ ok: true }", /Object and array/],
    ["sample.window?.length === 1", /Optional/],
  ] as const;
  for (const [expression, message] of cases) {
    const { result } = compileGraph(`flowchart TD
    %% seawitch: function bad(sample: Sample): string
    %% seawitch: import type { Sample } from "./types.js"
    start["start"] --> gate{"${expression}"}
    gate -->|true| yes["return 'yes'"]
    gate -->|false| no["return 'no'"]
`);
    const diagnostic = result.diagnostics.find((item) => item.code === 'SW016');
    assert.ok(diagnostic, `${expression}\n${result.diagnostics.map((item) => item.message).join('\n')}`);
    assert.match(diagnostic.message, message);
    assert.equal(result.outputs.length, 0);
  }
});

test('an overloaded call in a return expression is rejected', () => {
  const staged = stage();
  writeFileSync(
    path.join(staged.src, 'checks.ts'),
    `export function overloaded(value: number): string;
export function overloaded(value: string): string;
export function overloaded(value: number | string): string { return String(value); }
`,
  );
  writeFileSync(
    path.join(staged.src, 'graph.sea.mmd'),
    `flowchart TD
    %% seawitch: function bad(sample: Sample): string
    %% seawitch: import type { Sample } from "./types.js"
    %% seawitch: import { overloaded } from "./checks.js"
    start["start"] --> done["return overloaded(sample.value)"]
`,
  );
  const result = compile({
    entries: [path.join(staged.src, 'graph.sea.mmd')],
    srcRoot: staged.src,
    outRoot: staged.out,
  });
  assert.equal(result.diagnostics.some((item) => item.code === 'SW304' && item.nodeId === 'done'), true);
  assert.equal(result.outputs.length, 0);
});

test('a non-boolean expression decision is rejected', () => {
  const { result } = compileGraph(`flowchart TD
    %% seawitch: function bad(sample: Sample): string
    %% seawitch: import type { Sample } from "./types.js"
    start["start"] --> gate{"sample.leaf"}
    gate -->|true| yes["return 'yes'"]
    gate -->|false| no["return 'no'"]
`);
  assert.equal(result.diagnostics.some((item) => item.code === 'SW301' && item.nodeId === 'gate'), true);
  assert.equal(result.outputs.length, 0);
});

test('a branch-local expression result cannot be read after the join', () => {
  const { result } = compileGraph(`flowchart TD
    %% seawitch: function bad(sample: Sample): string
    %% seawitch: import type { Sample } from "./types.js"
    start["start"] --> gate{"sample.supports"}
    gate -->|true| onlyOnTrue["sample.leaf"]
    gate -->|false| other["'other'"]
    onlyOnTrue --> joined["return onlyOnTrue"]
    other --> joined
`);
  assert.equal(result.diagnostics.some((item) => item.code === 'SW203' && item.nodeId === 'joined'), true);
  assert.equal(result.outputs.length, 0);
});

test('the window example renders the expression that runs', async () => {
  const source = readFileSync(path.join(repoRoot, 'examples/window/window.sea.mmd'), 'utf8');
  const svg = await renderMermaid(source, 'seawitch-window');
  assert.equal(svg.includes("sample.window === 'late'"), true);
  assert.equal(svg.includes('sample.leaf'), true);
  assert.equal(svg.includes("return 'closed'"), true);
});

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { compile, type CompileResult } from '../src/compile.js';
import { mermaidAccepts } from './renderMermaid.js';

const repoRoot = path.join(import.meta.dirname, '..');
const exampleDir = path.join(repoRoot, 'examples/order');

function stage(): { root: string; src: string; out: string } {
  const root = mkdtempSync(path.join(tmpdir(), 'seawitch-order-'));
  const src = path.join(root, 'examples', 'order');
  cpSync(exampleDir, src, { recursive: true });
  writeFileSync(path.join(root, 'package.json'), '{ "type": "module" }\n');
  return { root, src, out: path.join(root, 'generated') };
}

function compileFiles(staged: { src: string; out: string }, names: string[]): CompileResult {
  return compile({
    entries: names.map((name) => path.join(staged.src, name)),
    srcRoot: staged.src,
    outRoot: staged.out,
  });
}

function writeGraph(staged: { src: string }, name: string, source: string): void {
  writeFileSync(path.join(staged.src, name), source);
}

function requireDiagnostic(result: CompileResult, code: CompileResult['diagnostics'][number]['code'], nodeId?: string) {
  const diagnostic = result.diagnostics.find((item) => item.code === code && (nodeId === undefined || item.nodeId === nodeId));
  assert.ok(
    diagnostic,
    result.diagnostics.map((item) => `${item.code} [${item.nodeId ?? ''}] ${item.message}`).join('\n'),
  );
  assert.equal(result.outputs.length, 0);
  return diagnostic;
}

test('a typed object flows through a join and the shared call runs once', async () => {
  const staged = stage();
  const first = compileFiles(staged, ['fulfillOrder.sea.mmd']);
  const second = compileFiles(staged, ['fulfillOrder.sea.mmd']);
  assert.deepEqual(first.diagnostics, []);
  assert.deepEqual(
    first.outputs.map((output) => output.contents),
    second.outputs.map((output) => output.contents),
  );
  const generated = first.outputs[0]?.contents ?? '';
  assert.match(generated, /const normalized = normalize\(order\);/);
  assert.match(generated, /const expedited = isExpedited\(normalized\);/);
  assert.match(generated, /if \(expedited\) \{/);
  assert.match(generated, /noteExpedited\(normalized\);/);
  assert.match(generated, /noteStandard\(normalized\);/);
  assert.match(generated, /receiptFor\(normalized, expedited\)/);
  assert.match(generated, /return receipt;/);
  assert.equal(generated.includes('while ('), false);
  assert.equal(generated.includes('switch ('), false);

  const caller = path.join(staged.src, 'caller.ts');
  const tsc = path.join(repoRoot, 'node_modules/typescript/bin/tsc');
  const checked = spawnSync(
    process.execPath,
    [tsc, '--noEmit', '--strict', '--module', 'nodenext', '--moduleResolution', 'nodenext', '--target', 'es2022', '--skipLibCheck', caller],
    { cwd: staged.root, encoding: 'utf8' },
  );
  assert.equal(checked.status, 0, `${checked.stdout}\n${checked.stderr}`);

  const orders = await import(pathToFileURL(path.join(staged.src, 'orders.ts')).href);
  const imported = await import(pathToFileURL(caller).href);
  orders.resetOrderCalls();
  assert.deepEqual(imported.callFulfillOrder({ id: ' a ', expedited: true, items: 2 }), {
    orderId: 'a',
    total: 6,
    copy: 'expedited',
  });
  assert.deepEqual(orders.orderCalls(), { expedited: 1, standard: 0, receipt: 1 });

  orders.resetOrderCalls();
  assert.deepEqual(imported.callFulfillOrder({ id: 'b', expedited: false, items: 3 }), {
    orderId: 'b',
    total: 6,
    copy: 'standard',
  });
  assert.deepEqual(orders.orderCalls(), { expedited: 0, standard: 1, receipt: 1 });
});

test('a literal true decision is accepted', async () => {
  const staged = stage();
  writeGraph(
    staged,
    'acceptLiteral.sea.mmd',
    `flowchart TD
    %% seawitch: function acceptLiteral(order: Order): string
    %% seawitch: import type { Order } from "./types.js"
    %% seawitch: import { alwaysExpedited } from "./checks.js"
    start["start"] --> gate{"call alwaysExpedited(order)"}
    gate -->|true| yes["return 'yes'"]
    gate -->|false| no["return 'no'"]
`,
  );
  const result = compileFiles(staged, ['acceptLiteral.sea.mmd']);
  assert.deepEqual(result.diagnostics, []);
  const imported = await import(pathToFileURL(path.join(staged.out, 'acceptLiteral.ts')).href);
  assert.equal(imported.acceptLiteral({ id: 'a', expedited: false, items: 1 }), 'yes');
});

test('non-boolean, any, unknown, and nullable decisions are rejected', () => {
  const cases = [
    ['asText', 'string'],
    ['asAny', 'any'],
    ['asUnknown', 'unknown'],
    ['asNullable', 'null'],
  ] as const;
  for (const [name, expected] of cases) {
    const staged = stage();
    writeGraph(
      staged,
      'badDecision.sea.mmd',
      `flowchart TD
    %% seawitch: function badDecision(order: Order): string
    %% seawitch: import type { Order } from "./types.js"
    %% seawitch: import { ${name} } from "./checks.js"
    start["start"] --> gate{"call ${name}(order)"}
    gate -->|true| yes["return 'yes'"]
    gate -->|false| no["return 'no'"]
`,
    );
    const result = compileFiles(staged, ['badDecision.sea.mmd']);
    const diagnostic = requireDiagnostic(result, 'SW301', 'gate');
    assert.match(diagnostic.message, new RegExp(expected));
  }
});

test('a branch-local result cannot be read after the branches converge', () => {
  const staged = stage();
  writeGraph(
    staged,
    'branchLocal.sea.mmd',
    `flowchart TD
    %% seawitch: function branchLocal(order: Order): Receipt
    %% seawitch: import type { Order, Receipt } from "./types.js"
    %% seawitch: import { normalize, isExpedited, noteExpedited, noteStandard, receiptFor } from "./orders.js"
    start["start"] --> normalized["call normalize(order)"]
    normalized --> expedited{"call isExpedited(normalized)"}
    expedited -->|true| fast["call noteExpedited(normalized)"]
    expedited -->|false| regular["call noteStandard(normalized)"]
    fast --> receipt["call receiptFor(fast, expedited)"]
    regular --> receipt
    receipt --> done["return receipt"]
`,
  );
  const result = compileFiles(staged, ['branchLocal.sea.mmd']);
  const diagnostic = requireDiagnostic(result, 'SW203', 'receipt');
  assert.match(diagnostic.message, /fast/);
});

test('wrong argument type, wrong arity, and wrong return type are rejected', () => {
  const staged = stage();
  writeGraph(
    staged,
    'badArg.sea.mmd',
    `flowchart TD
    %% seawitch: function badArg(order: Order): Order
    %% seawitch: import type { Order } from "./types.js"
    %% seawitch: import { noteExpedited } from "./orders.js"
    start["start"] --> step["call noteExpedited('x')"]
    step --> done["return step"]
`,
  );
  requireDiagnostic(compileFiles(staged, ['badArg.sea.mmd']), 'SW303', 'step');

  writeGraph(
    staged,
    'badArity.sea.mmd',
    `flowchart TD
    %% seawitch: function badArity(order: Order): Order
    %% seawitch: import type { Order } from "./types.js"
    %% seawitch: import { noteExpedited } from "./orders.js"
    start["start"] --> step["call noteExpedited(order, order)"]
    step --> done["return step"]
`,
  );
  requireDiagnostic(compileFiles(staged, ['badArity.sea.mmd']), 'SW303', 'step');

  writeGraph(
    staged,
    'badReturn.sea.mmd',
    `flowchart TD
    %% seawitch: function badReturn(order: Order): Receipt
    %% seawitch: import type { Order, Receipt } from "./types.js"
    %% seawitch: import { normalize } from "./orders.js"
    start["start"] --> normalized["call normalize(order)"]
    normalized --> done["return normalized"]
`,
  );
  const returned = requireDiagnostic(compileFiles(staged, ['badReturn.sea.mmd']), 'SW302', 'done');
  assert.match(returned.message, /Receipt/);
});

test('generic, overloaded, rest, and Promise callees are rejected', () => {
  const staged = stage();
  writeGraph(
    staged,
    'unsupported.sea.mmd',
    `flowchart TD
    %% seawitch: function unsupported(order: Order): Order
    %% seawitch: import type { Order } from "./types.js"
    %% seawitch: import { ident, overloaded, joinLabels, later } from "./checks.js"
    start["start"] --> generic["call ident(order)"]
    generic --> overload["call overloaded(generic)"]
    overload --> rest["call joinLabels(overload)"]
    rest --> asyncCall["call later(rest)"]
    asyncCall --> done["return asyncCall"]
`,
  );
  const result = compileFiles(staged, ['unsupported.sea.mmd']);
  for (const nodeId of ['generic', 'overload', 'rest', 'asyncCall']) {
    assert.ok(
      result.diagnostics.some((item) => item.code === 'SW304' && item.nodeId === nodeId),
      result.diagnostics.map((item) => `${item.code} [${item.nodeId ?? ''}] ${item.message}`).join('\n'),
    );
  }
  assert.equal(result.outputs.length, 0);
});

test('missing imports, bad specifiers, and the wrong Seawitch export are rejected', () => {
  const staged = stage();
  writeGraph(
    staged,
    'unknownCall.sea.mmd',
    `flowchart TD
    %% seawitch: function unknownCall(order: Order): Order
    %% seawitch: import type { Order } from "./types.js"
    start["start"] --> step["call missing(order)"]
    step --> done["return step"]
`,
  );
  requireDiagnostic(compileFiles(staged, ['unknownCall.sea.mmd']), 'SW401', 'step');

  writeGraph(
    staged,
    'missingModule.sea.mmd',
    `flowchart TD
    %% seawitch: function missingModule(order: Order): Order
    %% seawitch: import type { Order } from "./types.js"
    %% seawitch: import { normalize } from "./missing.js"
    start["start"] --> step["call normalize(order)"]
    step --> done["return step"]
`,
  );
  requireDiagnostic(compileFiles(staged, ['missingModule.sea.mmd']), 'SW404');

  writeGraph(
    staged,
    'bareImport.sea.mmd',
    `flowchart TD
    %% seawitch: function bareImport(order: Order): Order
    %% seawitch: import type { Order } from "./types.js"
    %% seawitch: import { normalize } from "orders"
    start["start"] --> step["call normalize(order)"]
    step --> done["return step"]
`,
  );
  requireDiagnostic(compileFiles(staged, ['bareImport.sea.mmd']), 'SW404');

  writeGraph(
    staged,
    'defaultImport.sea.mmd',
    `flowchart TD
    %% seawitch: function defaultImport(order: Order): Order
    %% seawitch: import type { Order } from "./types.js"
    %% seawitch: import normalize from "./orders.js"
    start["start"] --> step["call normalize(order)"]
    step --> done["return step"]
`,
  );
  requireDiagnostic(compileFiles(staged, ['defaultImport.sea.mmd']), 'SW404');

  writeGraph(
    staged,
    'wrongExport.sea.mmd',
    `flowchart TD
    %% seawitch: function wrongExport(order: Order): Receipt
    %% seawitch: import type { Order, Receipt } from "./types.js"
    %% seawitch: import { other } from "./fulfillOrder.sea.mmd"
    start["start"] --> step["call other(order)"]
    step --> done["return step"]
`,
  );
  requireDiagnostic(compileFiles(staged, ['wrongExport.sea.mmd']), 'SW402');
});

test('a flowchart cycle and a Seawitch import cycle are rejected', () => {
  const staged = stage();
  writeGraph(
    staged,
    'looped.sea.mmd',
    `flowchart TD
    %% seawitch: function looped(order: Order): Order
    %% seawitch: import type { Order } from "./types.js"
    %% seawitch: import { normalize } from "./orders.js"
    start["start"] --> step["call normalize(order)"]
    step --> step
`,
  );
  requireDiagnostic(compileFiles(staged, ['looped.sea.mmd']), 'SW108');

  writeGraph(
    staged,
    'ping.sea.mmd',
    `flowchart TD
    %% seawitch: function ping(order: Order): Order
    %% seawitch: import type { Order } from "./types.js"
    %% seawitch: import { pong } from "./pong.sea.mmd"
    start["start"] --> step["call pong(order)"]
    step --> done["return step"]
`,
  );
  writeGraph(
    staged,
    'pong.sea.mmd',
    `flowchart TD
    %% seawitch: function pong(order: Order): Order
    %% seawitch: import type { Order } from "./types.js"
    %% seawitch: import { ping } from "./ping.sea.mmd"
    start["start"] --> step["call ping(order)"]
    step --> done["return step"]
`,
  );
  const cycle = requireDiagnostic(compileFiles(staged, ['ping.sea.mmd']), 'SW403');
  assert.match(cycle.message, /ping\.sea\.mmd/);
  assert.match(cycle.message, /pong\.sea\.mmd/);
});

test('a reachable call with no return is rejected', () => {
  const staged = stage();
  writeGraph(
    staged,
    'stopped.sea.mmd',
    `flowchart TD
    %% seawitch: function stopped(order: Order): Order
    %% seawitch: import type { Order } from "./types.js"
    %% seawitch: import { normalize } from "./orders.js"
    start["start"] --> step["call normalize(order)"]
`,
  );
  requireDiagnostic(compileFiles(staged, ['stopped.sea.mmd']), 'SW107', 'step');
});

test('invalid Mermaid syntax fails before code generation', async () => {
  const source = `flowchart TD
start["start"] -->
`;
  assert.equal(await mermaidAccepts(source), false);
  const staged = stage();
  writeGraph(staged, 'broken.sea.mmd', source);
  const result = compileFiles(staged, ['broken.sea.mmd']);
  requireDiagnostic(result, 'SW013');
  assert.equal(readFileSync(path.join(staged.src, 'broken.sea.mmd'), 'utf8'), source);
});

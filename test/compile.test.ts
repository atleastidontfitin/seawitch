import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { compile } from '../src/compile.js';

const repoRoot = path.join(import.meta.dirname, '..');
const exampleDir = path.join(repoRoot, 'examples/classifyNumber');

function stage(mutate?: (file: string, source: string) => string): { root: string; src: string; out: string } {
  const root = mkdtempSync(path.join(tmpdir(), 'seawitch-'));
  const src = path.join(root, 'examples', 'classifyNumber');
  cpSync(exampleDir, src, { recursive: true });
  writeFileSync(path.join(root, 'package.json'), '{ "type": "module" }\n');
  if (mutate) {
    const target = path.join(src, 'classifyNumber.sea.mmd');
    writeFileSync(target, mutate('classifyNumber.sea.mmd', readFileSync(target, 'utf8')));
  }
  return { root, src, out: path.join(root, 'generated') };
}

function compileExample(staged: { src: string; out: string }) {
  return compile({
    entries: [
      path.join(staged.src, 'classifyNumber.sea.mmd'),
      path.join(staged.src, 'describeNumber.sea.mmd'),
    ],
    srcRoot: staged.src,
    outRoot: staged.out,
  });
}

test('classifyNumber and describeNumber execute, and caller.ts typechecks', async () => {
  const staged = stage();
  const result = compileExample(staged);
  assert.deepEqual(result.diagnostics, []);
  const caller = path.join(staged.src, 'caller.ts');
  const tsc = path.join(repoRoot, 'node_modules/typescript/bin/tsc');
  const checked = spawnSync(
    process.execPath,
    [
      tsc,
      '--noEmit',
      '--strict',
      '--module',
      'nodenext',
      '--moduleResolution',
      'nodenext',
      '--target',
      'es2022',
      '--skipLibCheck',
      caller,
    ],
    { cwd: staged.root, encoding: 'utf8' },
  );
  assert.equal(checked.status, 0, `${checked.stdout}\n${checked.stderr}`);
  const imported = await import(pathToFileURL(caller).href);
  assert.equal(imported.callClassifyNumber(-1), 'negative');
  assert.equal(imported.callClassifyNumber(0), 'zero');
  assert.equal(imported.callClassifyNumber(1), 'positive');
  assert.equal(imported.callDescribeNumber(0), 'zero');
});

test('a missing false edge reports SW104 and does not emit', () => {
  const staged = stage((_file, source) => source.replace('    zero -->|false| positiveResult["return \'positive\'"]\n', ''));
  const result = compileExample(staged);
  const diagnostic = result.diagnostics.find((item) => item.code === 'SW104');
  assert.ok(diagnostic);
  assert.equal(diagnostic.file, 'classifyNumber.sea.mmd');
  assert.equal(diagnostic.nodeId, 'zero');
  assert.equal(diagnostic.line > 0, true);
  assert.match(diagnostic.message, /false/);
  assert.equal(result.outputs.length, 0);
  const emitted = existsSync(staged.out) ? readdirSync(staged.out).filter((name) => name.endsWith('.ts')) : [];
  assert.deepEqual(emitted, []);
});

test('an incorrect return type reports SW302', () => {
  const staged = stage((_file, source) => source.replace("return 'positive'", "return 'nope'"));
  const result = compileExample(staged);
  const diagnostic = result.diagnostics.find((item) => item.code === 'SW302');
  assert.ok(diagnostic, result.diagnostics.map((item) => `${item.code} ${item.message}`).join('\n'));
  assert.equal(diagnostic.nodeId, 'positiveResult');
  assert.match(diagnostic.message, /Classification/);
  assert.equal(result.outputs.length, 0);
});

test('compiling the same source twice emits identical text', () => {
  const first = stage();
  const second = stage();
  const left = compileExample(first);
  const right = compileExample(second);
  assert.deepEqual(left.diagnostics, []);
  assert.deepEqual(right.diagnostics, []);
  assert.deepEqual(
    left.outputs.map((output) => output.contents),
    right.outputs.map((output) => output.contents),
  );
});

test('the CLI compiles classifyNumber and describeNumber', () => {
  const staged = stage();
  const cli = path.join(repoRoot, 'src/cli.ts');
  const ran = spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      cli,
      'compile',
      path.join(staged.src, 'classifyNumber.sea.mmd'),
      path.join(staged.src, 'describeNumber.sea.mmd'),
      '--src',
      staged.src,
      '--out',
      staged.out,
    ],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  assert.equal(ran.status, 0, `${ran.stdout}\n${ran.stderr}`);
  assert.equal(readFileSync(path.join(staged.out, 'classifyNumber.ts'), 'utf8').includes('export function classifyNumber'), true);
  assert.equal(readFileSync(path.join(staged.out, 'describeNumber.ts'), 'utf8').includes('classifyNumber(value)'), true);
});

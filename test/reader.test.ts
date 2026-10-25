import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { compile } from '../src/compile.js';
import { formatLabel } from '../src/render/plaintext.js';
import { render } from '../src/render.js';
import { renderMermaid } from './renderMermaid.js';

const repoRoot = path.join(import.meta.dirname, '..');

const vocabulary = new Map<string, string>([
  ['path:ctx.risk', 'risk'],
  ['path:ctx.pep_window', 'PEP timing'],
  ['path:ctx.confirmed_infection', 'infection confirmed'],
  ['path:other.risk', 'other risk'],
  ['lit:string:high', 'high'],
  ['lit:string:moderate', 'moderate'],
  ['lit:string:low', 'low'],
  ['lit:string:very_low', 'very low'],
  ['lit:string:late', 'late'],
  ['lit:string:completed follow-up', 'completed follow-up'],
]);

function stage(): { root: string; src: string; out: string } {
  const root = mkdtempSync(path.join(tmpdir(), 'seawitch-reader-'));
  const src = path.join(root, 'src');
  mkdirSync(src);
  writeFileSync(path.join(root, 'package.json'), '{ "type": "module" }\n');
  writeFileSync(path.join(src, 'types.ts'), 'export type Context = { risk: string; pep_window: string; confirmed_infection: boolean };\n');
  return { root, src, out: path.join(root, 'diagrams') };
}

test('plain-language operators, grouping, and alternative lists', () => {
  const say = (expression: string) => formatLabel(expression, vocabulary);
  assert.equal(say("ctx.risk === 'high'"), 'risk is high');
  assert.equal(say("ctx.risk !== 'high'"), 'risk is not high');
  assert.equal(say('ctx.confirmed_infection && ctx.risk === \'low\''), 'infection confirmed and risk is low');
  assert.equal(say("ctx.risk === 'high' || ctx.pep_window === 'late'"), 'risk is high or PEP timing is late');
  assert.equal(say('!ctx.confirmed_infection'), 'not infection confirmed');
  assert.equal(say("!(ctx.risk === 'high' || ctx.risk === 'moderate')"), 'not (risk is high or moderate)');
  assert.equal(say("!ctx.confirmed_infection && ctx.risk === 'low'"), '(not infection confirmed) and risk is low');
  assert.equal(
    say("(ctx.risk === 'high' || ctx.risk === 'moderate') && ctx.confirmed_infection"),
    '(risk is high or moderate) and infection confirmed',
  );
  assert.equal(
    say("ctx.risk === 'high' || ctx.risk === 'moderate' && ctx.confirmed_infection"),
    'risk is high or (risk is moderate and infection confirmed)',
  );
  assert.equal(say("ctx.risk === 'high' || ctx.risk === 'moderate'"), 'risk is high or moderate');
  assert.equal(
    say("ctx.risk === 'high' || ctx.risk === 'moderate' || ctx.risk === 'low'"),
    'risk is high, moderate, or low',
  );
  assert.equal(
    say("ctx.risk === 'high' || ctx.risk === 'moderate' || ctx.risk === 'low' || ctx.risk === 'very_low'"),
    'risk is high, moderate, low, or very low',
  );
  assert.equal(
    say("ctx.risk === 'high' || ctx.risk === 'moderate' || ctx.risk === 'low' || ctx.risk === 'very_low' || ctx.risk === 'late'"),
    'risk is high, moderate, low, very low, or late',
  );
  assert.equal(
    say("ctx.risk === 'high' || ctx.risk === 'moderate' || ctx.risk === 'low' || ctx.risk === 'very_low' || ctx.pep_window === 'late'"),
    '(risk is high, moderate, low, or very low) or PEP timing is late',
  );
  assert.equal(say("ctx.risk !== 'high' || ctx.risk !== 'moderate'"), 'risk is not high or risk is not moderate');
  assert.equal(say("ctx.risk === 'high' || other.risk === 'high'"), 'risk is high or other risk is high');
  assert.equal(say('left(ctx) === 1 || left(ctx) === 2'), 'left(ctx) is 1 or left(ctx) is 2');
  assert.equal(say('ctx.risk < 0'), 'ctx.risk < 0');
  assert.equal(formatLabel('return true', vocabulary), 'True');
  assert.equal(formatLabel('return false', vocabulary), 'False');
  assert.equal(formatLabel('start', vocabulary), 'Start');
});

test('a literal can use different wording for different comparison subjects', () => {
  const staged = stage();
  writeFileSync(
    path.join(staged.src, 'shared.json'),
    `{
  "ctx.pep_window": "PEP timing",
  "strength": "strength",
  "'late'": "late",
  "'not_applicable'": "not applicable",
  "'unknown_timing'": "unknown timing",
  "ctx.pep_window['unknown_timing']": "unknown"
}
`,
  );
  const file = path.join(staged.src, 'checkRisk.sea.mmd');
  const original = `flowchart TD
    %% seawitch: function checkRisk(ctx: Context, strength: string): string
    %% seawitch: import type { Context } from "./types.js"
    %% seawitch: vocabulary "./shared.json"
    start["start"] --> window{"ctx.pep_window === 'unknown_timing'"}
    window -->|false| open["return 'unknown_timing'"]
    window -->|true| named{"strength === 'unknown_timing'"}
    named -->|false| other{"strength === 'consider' || strength === 'unknown_timing'"}
    named -->|true| pair{"ctx.pep_window === 'late' || ctx.pep_window === 'unknown_timing'"}
    pair -->|false| missed{"ctx.pep_window === 'bogus'"}
    pair -->|true| triple{"ctx.pep_window === 'late' || ctx.pep_window === 'unknown_timing' || ctx.pep_window === 'not_applicable'"}
    triple -->|true| done["return 'yes'"]
    triple -->|false| no["return 'no'"]
    missed -->|true| yes["return 'yes'"]
    missed -->|false| no
    other -->|true| yesAgain["return 'yes'"]
    other -->|false| noAgain["return 'no'"]
`;
  writeFileSync(file, original);
  const first = render({ entries: [file], outRoot: staged.out });
  const second = render({ entries: [file], outRoot: staged.out });
  assert.deepEqual(first.diagnostics, []);
  assert.equal(first.outputs[0]?.contents, second.outputs[0]?.contents);
  const reader = first.outputs[0]?.contents ?? '';
  assert.match(reader, /window\{"PEP timing is unknown"\}/);
  assert.match(reader, /named\{"strength is unknown timing"\}/);
  assert.match(reader, /pair\{"PEP timing is late or unknown"\}/);
  assert.match(reader, /triple\{"PEP timing is late, unknown, or not applicable"\}/);
  assert.match(reader, /other\{"strength is 'consider' or unknown timing"\}/);
  assert.match(reader, /open\["unknown timing"\]/);
  assert.match(reader, /missed\{"PEP timing is 'bogus'"\}/);
  const plain = path.join(staged.src, 'plain.sea.mmd');
  writeFileSync(
    plain,
    `flowchart TD
    %% seawitch: function plain(ctx: Context): string
    %% seawitch: import type { Context } from "./types.js"
    %% seawitch: vocabulary "./shared.json"
    start["start"] --> window{"ctx.pep_window === 'unknown_timing'"}
    window -->|true| yes["return 'yes'"]
    window -->|false| no["return 'no'"]
`,
  );
  const compiled = compile({ entries: [plain], srcRoot: staged.src, outRoot: path.join(staged.root, 'generated') });
  assert.deepEqual(compiled.diagnostics, []);
  const typescript = compiled.outputs[0]?.contents ?? '';
  assert.match(typescript, /ctx\.pep_window === 'unknown_timing'/);
  assert.equal(typescript.includes('PEP timing is unknown'), false);
});

test('inline and imported vocabularies render, and conflicts are rejected', () => {
  const staged = stage();
  writeFileSync(
    path.join(staged.src, 'shared.json'),
    JSON.stringify({ 'ctx.risk': 'risk', "'high'": 'high', "'moderate'": 'moderate' }, null, 2),
  );
  const file = path.join(staged.src, 'checkRisk.sea.mmd');
  const original = `flowchart TD
    %% seawitch: function checkRisk(ctx: Context): boolean
    %% seawitch: import type { Context } from "./types.js"
    %% seawitch: vocabulary "./shared.json"
    %% seawitch: vocabulary ctx.pep_window = PEP timing
    %% A note for readers of the source.
    start["start"] --> risk{"ctx.risk === 'high' || ctx.risk === 'moderate'"}
    risk -->|true| yes["return true"]
    risk -->|false| no["return false"]
`;
  writeFileSync(file, original);
  const rendered = render({ entries: [file], outRoot: staged.out });
  assert.deepEqual(rendered.diagnostics, []);
  const reader = rendered.outputs[0]?.contents ?? '';
  assert.match(reader, /%% Generated by Seawitch\. Do not edit\./);
  assert.equal(reader.includes('seawitch:'), false);
  assert.match(reader, /%% A note for readers of the source\./);
  assert.match(reader, /start\["Start"\] --> risk\{"risk is high or moderate"\}/);
  assert.match(reader, /yes\["True"\]/);
  assert.match(reader, /no\["False"\]/);
  assert.equal(readFileSync(file, 'utf8'), original);
  const again = render({ entries: [file], outRoot: staged.out });
  assert.equal(again.outputs[0]?.contents, reader);

  const compiled = compile({ entries: [file], srcRoot: staged.src, outRoot: path.join(staged.root, 'generated') });
  assert.deepEqual(compiled.diagnostics, []);
  const typescript = compiled.outputs[0]?.contents ?? '';
  assert.match(typescript, /ctx\.risk === 'high' \|\| ctx\.risk === 'moderate'/);
  assert.equal(typescript.includes('PEP timing'), false);

  writeFileSync(
    path.join(staged.src, 'shared.json'),
    JSON.stringify({ 'ctx.risk': 'exposure risk', "'high'": 'high', "'moderate'": 'moderate' }, null, 2),
  );
  const recompiled = compile({ entries: [file], srcRoot: staged.src, outRoot: path.join(staged.root, 'generated-2') });
  assert.equal(recompiled.outputs[0]?.contents, typescript);
});

test('duplicate, conflicting, invalid, and missing vocabularies are rejected', () => {
  const staged = stage();
  const base = `flowchart TD
    %% seawitch: function checkRisk(ctx: Context): boolean
    %% seawitch: import type { Context } from "./types.js"
`;
  const graph = `
    start["start"] --> yes["return true"]
`;
  const cases: { extra: string; message: RegExp }[] = [
    {
      extra: '    %% seawitch: vocabulary ctx.risk = risk\n    %% seawitch: vocabulary ctx.risk = risk\n',
      message: /repeats/,
    },
    {
      extra: '    %% seawitch: vocabulary ctx.risk = risk\n    %% seawitch: vocabulary ctx . risk = exposure risk\n',
      message: /earlier mapping/,
    },
    {
      extra: "    %% seawitch: vocabulary ctx.risk === 'high' = urgent\n",
      message: /a literal/,
    },
    {
      extra: '    %% seawitch: vocabulary "./missing.json"\n',
      message: /Cannot read vocabulary/,
    },
    {
      extra:
        "    %% seawitch: vocabulary ctx.pep_window['unknown_timing'] = unknown\n    %% seawitch: vocabulary ctx.pep_window['unknown_timing'] = unknown\n",
      message: /repeats/,
    },
    {
      extra:
        "    %% seawitch: vocabulary ctx.pep_window['unknown_timing'] = unknown\n    %% seawitch: vocabulary ctx . pep_window [ 'unknown_timing' ] = mystery\n",
      message: /earlier mapping/,
    },
    {
      extra: '    %% seawitch: vocabulary ctx.pep_window[name] = unknown\n',
      message: /subject\['literal'\]/,
    },
    {
      extra: '    %% seawitch: vocabulary actIsExcludedFromRoutineHivPep(ctx, profile) = Is the act excluded?\n',
      message: /subject\['literal'\]/,
    },
  ];
  for (const item of cases) {
    const file = path.join(staged.src, `bad-${cases.indexOf(item)}.sea.mmd`);
    writeFileSync(file, `${base}${item.extra}${graph}`);
    const result = render({ entries: [file], outRoot: staged.out });
    assert.equal(result.outputs.length, 0);
    assert.match(result.diagnostics.map((diagnostic) => diagnostic.message).join('\n'), item.message);
    assert.equal(result.diagnostics.every((diagnostic) => diagnostic.code === 'SW018'), true);
  }
});

test('a reader view is standard Mermaid and a .mmd file is not compiler input', async () => {
  const staged = stage();
  const file = path.join(staged.src, 'checkRisk.sea.mmd');
  writeFileSync(
    file,
    `flowchart TD
    %% seawitch: function checkRisk(ctx: Context): boolean
    %% seawitch: import type { Context } from "./types.js"
    %% seawitch: vocabulary ctx.risk = say "risk"
    %% seawitch: vocabulary 'high' = high
    start["start"] --> risk{"ctx.risk === 'high'"}
    risk -->|true| yes["return true"]
    risk -->|false| no["return false"]
`,
  );
  const rendered = render({ entries: [file], outRoot: staged.src });
  assert.deepEqual(rendered.diagnostics, []);
  const readerPath = path.join(staged.src, 'checkRisk.mmd');
  const reader = readFileSync(readerPath, 'utf8');
  assert.match(reader, /say #quot;risk#quot; is high/);
  assert.equal(reader.includes('%% seawitch:'), false);
  assert.equal(readFileSync(file, 'utf8').includes('say "risk"'), true);
  const svg = await renderMermaid(reader, 'reader-view');
  assert.equal(svg.includes('is high'), true);
  const rejected = compile({ entries: [readerPath], srcRoot: staged.src, outRoot: staged.out });
  assert.equal(rejected.outputs.length, 0);
  assert.equal(rejected.diagnostics.some((diagnostic) => diagnostic.code === 'SW010'), true);
});

test('the render CLI writes a reader view and does not change executable output', () => {
  const staged = stage();
  const file = path.join(staged.src, 'checkRisk.sea.mmd');
  writeFileSync(
    file,
    `flowchart TD
    %% seawitch: function checkRisk(ctx: Context): boolean
    %% seawitch: import type { Context } from "./types.js"
    start["start"] --> yes["return true"]
`,
  );
  const ran = spawnSync(
    process.execPath,
    ['--import', 'tsx', path.join(repoRoot, 'src/cli.ts'), 'render', file, '--out', staged.out],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  assert.equal(ran.status, 0, `${ran.stdout}\n${ran.stderr}`);
  assert.match(readFileSync(path.join(staged.out, 'checkRisk.mmd'), 'utf8'), /yes\["True"\]/);
});

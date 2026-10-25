import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { compile } from '../src/compile.js';
import { formatLabel } from '../src/render/plaintext.js';
import { render } from '../src/render.js';
import { mermaidAccepts } from './renderMermaid.js';

const phrases = new Map<string, string>([
  ['path:act', 'the act'],
  ['path:intactBarrier', 'an intact barrier'],
  ['path:veryLowRisk', 'very low risk'],
  ['path:routineHivPep', 'routine HIV PEP'],
  ['path:beforeWindow', 'before the window'],
  ['path:completedCourse', 'a completed course'],
  ['path:recommendation', 'the recommendation'],
  ['path:profile', 'the profile'],
  ['path:pep', 'PEP'],
  ['path:pepWindow', 'the PEP window'],
  ['path:infection', 'infection'],
  ['path:item', 'the item'],
  ['path:thing', 'the thing'],
  ['path:ctx.pep_window', 'PEP timing'],
  ['path:strength', 'strength'],
  ['lit:string:unknown_timing', 'unknown timing'],
  ['lit:string:consider', 'consider'],
  ['when:path:ctx.pep_window|lit:string:unknown_timing', 'unknown'],
]);

const booleans = new Set([
  'actIsExcludedFromRoutineHivPep',
  'intactBarrierExcludesRoutineHivPep',
  'veryLowRiskExcludesRoutineHivPepBeforeWindow',
  'completedCourseOverridesRecommendation',
  'completedCourseReplacesRecommendation',
  'profileSupportsPep',
  'infectionIsConfirmed',
  'pepWindowIsLate',
  'courseIsCompleted',
  'labIsHIV',
  'itemExcludesThing',
  'itemOverridesThing',
  'itemSupportsThing',
  'itemRequiresThing',
  'itemAllowsThing',
  'itemReplacesThing',
  'itemIsReady',
  'itemDestroysThing',
  'itemExcludeThing',
  'sampleExcludesRoutineHivPep',
  'riskExcludesCareRequiresReview',
  'valueIsReadyIsLate',
  'actIsBarExcludesBaz',
  'checkThing',
  'left',
]);

function ask(label: string, decision = true): string {
  return formatLabel(label, phrases, { decision, booleanCallees: booleans });
}

test('boolean function names become questions from the vocabulary', () => {
  const required = [
    ['actIsExcludedFromRoutineHivPep(ctx, profile)', 'Is the act excluded from routine HIV PEP?'],
    ['intactBarrierExcludesRoutineHivPep(ctx, profile)', 'Does an intact barrier exclude routine HIV PEP?'],
    [
      'veryLowRiskExcludesRoutineHivPepBeforeWindow(ctx, profile)',
      'Does very low risk exclude routine HIV PEP before the window?',
    ],
    ['completedCourseOverridesRecommendation(ctx, mapped)', 'Does a completed course override the recommendation?'],
    ['completedCourseReplacesRecommendation(ctx, mapped)', 'Does a completed course replace the recommendation?'],
    ['profileSupportsPep(profile)', 'Does the profile support PEP?'],
    ['infectionIsConfirmed(ctx)', 'Is infection confirmed?'],
    ['pepWindowIsLate(ctx)', 'Is the PEP window late?'],
    ['courseIsCompleted(ctx)', 'Is course completed?'],
    ['labIsHIV(ctx)', 'Is lab HIV?'],
  ] as const;
  for (const [label, question] of required) {
    assert.equal(ask(label), question);
    assert.equal(question.startsWith('Is ') || question.startsWith('Does '), true);
    assert.equal(question.endsWith('?'), true);
    assert.equal(question.indexOf('?'), question.length - 1);
  }
  const verbs = [
    ['Excludes', 'exclude'],
    ['Overrides', 'override'],
    ['Supports', 'support'],
    ['Requires', 'require'],
    ['Allows', 'allow'],
    ['Replaces', 'replace'],
  ] as const;
  for (const [token, base] of verbs) {
    assert.equal(ask(`item${token}Thing(ctx)`), `Does the item ${base} the thing?`);
  }
  assert.equal(ask('actIsExcludedFromRoutineHivPep(ctx)', false), 'actIsExcludedFromRoutineHivPep(ctx)');
  assert.equal(ask('return actIsExcludedFromRoutineHivPep(ctx)'), 'actIsExcludedFromRoutineHivPep(ctx)');
  assert.equal(ask('call actIsExcludedFromRoutineHivPep(ctx, profile)'), 'Is the act excluded from routine HIV PEP?');
  assert.equal(ask('(actIsExcludedFromRoutineHivPep(ctx))'), 'Is the act excluded from routine HIV PEP?');
  assert.equal(ask('!actIsExcludedFromRoutineHivPep(ctx)'), 'not actIsExcludedFromRoutineHivPep(ctx)');
  assert.equal(
    ask('left(ctx) && actIsExcludedFromRoutineHivPep(ctx)'),
    'left(ctx) and actIsExcludedFromRoutineHivPep(ctx)',
  );
  assert.equal(ask('profile.supportsPep(profile)'), 'profile.supportsPep(profile)');
  assert.equal(ask('checkThing(ctx)'), 'checkThing(ctx)');
  assert.equal(ask('itemDestroysThing(ctx)'), 'itemDestroysThing(ctx)');
  assert.equal(ask('itemExcludeThing(ctx)'), 'itemExcludeThing(ctx)');
  assert.equal(ask('riskExcludesCareRequiresReview(ctx)'), 'riskExcludesCareRequiresReview(ctx)');
  assert.equal(ask('valueIsReadyIsLate(ctx)'), 'valueIsReadyIsLate(ctx)');
  assert.equal(ask('actIsBarExcludesBaz(ctx)'), 'actIsBarExcludesBaz(ctx)');
  assert.equal(ask("ctx.pep_window === 'unknown_timing'"), 'PEP timing is unknown');
  assert.equal(ask("strength === 'consider' || strength === 'unknown_timing'"), 'strength is consider or unknown timing');
  const unmapped = new Map<string, string>();
  assert.equal(
    formatLabel('actIsExcludedFromRoutineHivPep(ctx)', unmapped, {
      decision: true,
      booleanCallees: booleans,
    }),
    'Is act excluded from routine hiv pep?',
  );
  const ambiguous = new Map<string, string>([
    ['path:routineHiv', 'routine hiv'],
    ['path:hivPep', 'HIV PEP'],
  ]);
  assert.equal(
    formatLabel('sampleExcludesRoutineHivPep(ctx)', ambiguous, {
      decision: true,
      booleanCallees: booleans,
    }),
    'sampleExcludesRoutineHivPep(ctx)',
  );
  const quoted = new Map<string, string>([
    ['path:act', 'the "act"'],
    ['path:routineHivPep', 'routine HIV PEP'],
  ]);
  assert.equal(
    formatLabel('actIsExcludedFromRoutineHivPep(ctx)', quoted, { decision: true, booleanCallees: booleans }),
    'Is the "act" excluded from routine HIV PEP?',
  );
});

test('rendered questions follow boolean signatures and stay out of TypeScript', async () => {
  const staged = stage();
  writeFileSync(
    path.join(staged.src, 'predicates.ts'),
    `import type { Context } from './types.js';
export function actIsExcludedFromRoutineHivPep(ctx: Context): boolean { return ctx.confirmed_infection; }
export function intactBarrierExcludesRoutineHivPep(ctx: Context): boolean { return false; }
export function veryLowRiskExcludesRoutineHivPepBeforeWindow(ctx: Context): boolean { return false; }
export function completedCourseReplacesRecommendation(ctx: Context, mapped: string): boolean { return mapped === 'x'; }
export function itemIsReady(ctx: Context): string { return ctx.risk; }
export function itemDestroysThing(ctx: Context): boolean { return false; }
export function itemIsReadyGeneric<T extends string>(value: T): boolean { return value === value; }
export function sampleIsReady(ctx: Context): boolean;
export function sampleIsReady(ctx: string): boolean;
export function sampleIsReady(ctx: Context | string): boolean { return typeof ctx === 'string'; }
`,
  );
  writeFileSync(
    path.join(staged.src, 'questions.json'),
    JSON.stringify(
      {
        act: 'the act',
        intactBarrier: 'an intact barrier',
        veryLowRisk: 'very low risk',
        routineHivPep: 'routine HIV PEP',
        beforeWindow: 'before the window',
        completedCourse: 'a completed course',
        recommendation: 'the recommendation',
        'ctx.pep_window': 'PEP timing',
        strength: 'strength',
        "'unknown_timing'": 'unknown timing',
        "'consider'": 'consider',
        "ctx.pep_window['unknown_timing']": 'unknown',
      },
      null,
      2,
    ),
  );
  writeFileSync(
    path.join(staged.src, 'inner.sea.mmd'),
    `flowchart TD
    %% seawitch: function courseIsCompleted(ctx: Context): boolean
    %% seawitch: import type { Context } from "./types.js"
    start["start"] --> yes["return true"]
`,
  );
  const file = path.join(staged.src, 'check.sea.mmd');
  writeFileSync(
    file,
    `flowchart TD
    %% seawitch: function check(ctx: Context, mapped: string): boolean
    %% seawitch: import type { Context } from "./types.js"
    %% seawitch: import { actIsExcludedFromRoutineHivPep, intactBarrierExcludesRoutineHivPep, veryLowRiskExcludesRoutineHivPepBeforeWindow, completedCourseReplacesRecommendation, itemIsReady, itemDestroysThing, itemIsReadyGeneric, sampleIsReady } from "./predicates.js"
    %% seawitch: import { courseIsCompleted } from "./inner.sea.mmd"
    %% seawitch: vocabulary "./questions.json"
    start["start"] --> act{"actIsExcludedFromRoutineHivPep(ctx)"}
    act -->|true| window{"ctx.pep_window === 'unknown_timing'"}
    act -->|false| named{"strength === 'consider' || strength === 'unknown_timing'"}
    window -->|true| barrier{"intactBarrierExcludesRoutineHivPep(ctx)"}
    window -->|false| low{"veryLowRiskExcludesRoutineHivPepBeforeWindow(ctx)"}
    barrier -->|true| replaced{"completedCourseReplacesRecommendation(ctx, mapped)"}
    barrier -->|false| course{"courseIsCompleted(ctx)"}
    low -->|true| ready{"itemIsReady(ctx)"}
    low -->|false| destroyed{"itemDestroysThing(ctx)"}
    replaced -->|true| generic{"itemIsReadyGeneric(ctx.risk)"}
    replaced -->|false| overloaded{"sampleIsReady(ctx)"}
    named -->|true| compute["actIsExcludedFromRoutineHivPep(ctx)"]
    named -->|false| returned["return actIsExcludedFromRoutineHivPep(ctx)"]
    course -->|true| yes["return true"]
    course -->|false| yes
    ready -->|true| yes
    ready -->|false| yes
    destroyed -->|true| yes
    destroyed -->|false| yes
    generic -->|true| yes
    generic -->|false| yes
    overloaded -->|true| yes
    overloaded -->|false| yes
    compute --> yes
    returned --> yes
`,
  );
  const first = render({ entries: [file], outRoot: staged.out });
  const second = render({ entries: [file], outRoot: staged.out });
  assert.deepEqual(first.diagnostics, []);
  assert.equal(first.outputs[0]?.contents, second.outputs[0]?.contents);
  const reader = first.outputs[0]?.contents ?? '';
  assert.equal(reader.includes('%% seawitch:'), false);
  assert.match(reader, /act\{"Is the act excluded from routine HIV PEP\?"\}/);
  assert.match(reader, /barrier\{"Does an intact barrier exclude routine HIV PEP\?"\}/);
  assert.match(reader, /low\{"Does very low risk exclude routine HIV PEP before the window\?"\}/);
  assert.match(reader, /replaced\{"Does a completed course replace the recommendation\?"\}/);
  assert.match(reader, /course\{"Is course completed\?"\}/);
  assert.match(reader, /window\{"PEP timing is unknown"\}/);
  assert.match(reader, /named\{"strength is consider or unknown timing"\}/);
  assert.match(reader, /ready\{"itemIsReady\(ctx\)"\}/);
  assert.match(reader, /destroyed\{"itemDestroysThing\(ctx\)"\}/);
  assert.match(reader, /generic\{"itemIsReadyGeneric\(ctx\.risk\)"\}/);
  assert.match(reader, /overloaded\{"sampleIsReady\(ctx\)"\}/);
  assert.match(reader, /compute\["actIsExcludedFromRoutineHivPep\(ctx\)"\]/);
  assert.match(reader, /returned\["actIsExcludedFromRoutineHivPep\(ctx\)"\]/);
  assert.equal(await mermaidAccepts(reader), true);

  const quotedFile = path.join(staged.src, 'quoted.sea.mmd');
  writeFileSync(
    quotedFile,
    `flowchart TD
    %% seawitch: function quoted(ctx: Context): boolean
    %% seawitch: import type { Context } from "./types.js"
    %% seawitch: import { actIsExcludedFromRoutineHivPep } from "./predicates.js"
    %% seawitch: vocabulary act = the "act"
    %% seawitch: vocabulary routineHivPep = routine HIV PEP
    start["start"] --> act{"actIsExcludedFromRoutineHivPep(ctx)"}
    act -->|true| yes["return true"]
    act -->|false| no["return false"]
`,
  );
  const quoted = render({ entries: [quotedFile], outRoot: staged.out });
  assert.deepEqual(quoted.diagnostics, []);
  const quotedReader = quoted.outputs[0]?.contents ?? '';
  assert.match(quotedReader, /Is the #quot;act#quot; excluded from routine HIV PEP\?/);
  assert.equal(await mermaidAccepts(quotedReader), true);

  const plain = path.join(staged.src, 'plain.sea.mmd');
  writeFileSync(
    plain,
    `flowchart TD
    %% seawitch: function plain(ctx: Context): boolean
    %% seawitch: import type { Context } from "./types.js"
    %% seawitch: import { actIsExcludedFromRoutineHivPep } from "./predicates.js"
    %% seawitch: import { courseIsCompleted } from "./inner.sea.mmd"
    %% seawitch: vocabulary "./questions.json"
    start["start"] --> act{"actIsExcludedFromRoutineHivPep(ctx)"}
    act -->|true| course{"courseIsCompleted(ctx)"}
    act -->|false| no["return false"]
    course -->|true| yes["return true"]
    course -->|false| no
`,
  );
  const plainReader = render({ entries: [plain], outRoot: staged.out });
  assert.deepEqual(plainReader.diagnostics, []);
  assert.match(plainReader.outputs[0]?.contents ?? '', /Is the act excluded from routine HIV PEP\?/);
  assert.match(plainReader.outputs[0]?.contents ?? '', /Is course completed\?/);
  const compiled = compile({
    entries: [plain],
    srcRoot: staged.src,
    outRoot: path.join(staged.root, 'generated'),
  });
  const typescript = compiled.outputs.map((output) => output.contents).join('\n');
  assert.equal(
    compiled.diagnostics.map((diagnostic) => diagnostic.message).join('\n'),
    '',
  );
  assert.match(typescript, /actIsExcludedFromRoutineHivPep\(ctx\)/);
  assert.equal(typescript.includes('Is the act excluded'), false);
});

test('conflicting noun phrases are rejected before a question is written', () => {
  const staged = stage();
  writeFileSync(
    path.join(staged.src, 'predicates.ts'),
    `import type { Context } from './types.js';
export function actIsExcludedFromRoutineHivPep(ctx: Context): boolean { return ctx.confirmed_infection; }
`,
  );
  const file = path.join(staged.src, 'check.sea.mmd');
  writeFileSync(
    file,
    `flowchart TD
    %% seawitch: function check(ctx: Context): boolean
    %% seawitch: import type { Context } from "./types.js"
    %% seawitch: import { actIsExcludedFromRoutineHivPep } from "./predicates.js"
    %% seawitch: vocabulary act = the act
    %% seawitch: vocabulary act = an act
    start["start"] --> act{"actIsExcludedFromRoutineHivPep(ctx)"}
    act -->|true| yes["return true"]
    act -->|false| no["return false"]
`,
  );
  const rendered = render({ entries: [file], outRoot: staged.out });
  assert.equal(rendered.outputs.length, 0);
  assert.match(rendered.diagnostics.map((diagnostic) => diagnostic.message).join('\n'), /earlier mapping/);
});

function stage(): { root: string; src: string; out: string } {
  const root = mkdtempSync(path.join(tmpdir(), 'seawitch-questions-'));
  const src = path.join(root, 'src');
  mkdirSync(src);
  writeFileSync(path.join(root, 'package.json'), '{ "type": "module" }\n');
  writeFileSync(
    path.join(src, 'types.ts'),
    'export type Context = { risk: string; pep_window: string; confirmed_infection: boolean };\n',
  );
  return { root, src, out: path.join(root, 'diagrams') };
}

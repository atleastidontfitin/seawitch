#!/usr/bin/env tsx
import path from 'node:path';
import { parseArgs } from 'node:util';
import { compile, formatDiagnostics } from './compile.js';

const { positionals, values } = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: true,
  options: {
    src: { type: 'string' },
    out: { type: 'string' },
  },
});

if (positionals[0] !== 'compile' || positionals.length < 2 || !values.src || !values.out) {
  process.stderr.write('Usage: seawitch compile <files.sea.mmd...> --src <root> --out <dir>\n');
  process.exit(1);
}

const result = compile({
  entries: positionals.slice(1).map((entry) => path.resolve(entry)),
  srcRoot: path.resolve(values.src),
  outRoot: path.resolve(values.out),
});

if (result.diagnostics.length > 0) {
  process.stderr.write(`${formatDiagnostics(result.diagnostics)}\n`);
  process.exit(1);
}

for (const output of result.outputs) {
  process.stdout.write(`${output.path}\n`);
}

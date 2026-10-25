import fs from 'node:fs';
import path from 'node:path';
import type { Diagnostic } from './diagnostics.js';
import { parseFile } from './parse/file.js';
import { booleanDecisionCallees } from './render/booleanCallees.js';
import { renderReaderSource } from './render/mermaid.js';

export type RenderOptions = {
  entries: string[];
  outRoot: string;
};

export type RenderResult = {
  diagnostics: Diagnostic[];
  outputs: { path: string; contents: string }[];
};

export function render(options: RenderOptions): RenderResult {
  const diagnostics: Diagnostic[] = [];
  const outRoot = path.resolve(options.outRoot);
  const planned: { entry: string; outputPath: string }[] = [];
  const claimed = new Map<string, string>();

  for (const entry of options.entries) {
    const resolved = path.resolve(entry);
    if (!resolved.endsWith('.sea.mmd')) {
      diagnostics.push({
        code: 'SW010',
        file: path.basename(resolved),
        line: 1,
        message: `Seawitch renders reader views from .sea.mmd source only. '${path.basename(resolved)}' is not executable input.`,
      });
      continue;
    }
    const outputPath = path.join(outRoot, `${path.basename(resolved, '.sea.mmd')}.mmd`);
    if (!outputPath.endsWith('.mmd') || outputPath.endsWith('.sea.mmd') || outputPath === resolved) {
      diagnostics.push({
        code: 'SW018',
        file: path.basename(resolved),
        line: 1,
        message: `Refusing to write a reader view over executable source '${path.basename(resolved)}'.`,
      });
      continue;
    }
    const previous = claimed.get(outputPath);
    if (previous) {
      diagnostics.push({
        code: 'SW018',
        file: path.basename(resolved),
        line: 1,
        message: `Reader view '${path.basename(outputPath)}' would be written for both '${path.basename(previous)}' and '${path.basename(resolved)}'.`,
      });
      continue;
    }
    claimed.set(outputPath, resolved);
    planned.push({ entry: resolved, outputPath });
  }

  const rendered: { path: string; contents: string }[] = [];
  for (const item of planned) {
    if (!fs.existsSync(item.entry)) {
      diagnostics.push({
        code: 'SW404',
        file: path.basename(item.entry),
        line: 1,
        message: `Cannot read '${item.entry}'.`,
      });
      continue;
    }
    const source = fs.readFileSync(item.entry, 'utf8');
    const parsed = parseFile(source, item.entry, path.dirname(item.entry));
    diagnostics.push(...parsed.diagnostics);
    if (!parsed.graph) {
      continue;
    }
    rendered.push({
      path: item.outputPath,
      contents: renderReaderSource(source, parsed.graph.vocabulary, booleanDecisionCallees(parsed.graph)),
    });
  }

  if (diagnostics.length > 0) {
    return { diagnostics, outputs: [] };
  }

  for (const output of rendered) {
    fs.mkdirSync(path.dirname(output.path), { recursive: true });
    const current = fs.existsSync(output.path) ? fs.readFileSync(output.path, 'utf8') : undefined;
    if (current !== output.contents) {
      fs.writeFileSync(output.path, output.contents);
    }
  }
  return { diagnostics: [], outputs: rendered };
}

import fs from 'node:fs';
import path from 'node:path';
import type { Diagnostic } from './diagnostics.js';
import { formatDiagnostics } from './diagnostics.js';
import type { EmittedFile } from './emit/typescript.js';
import { emitGraph } from './emit/typescript.js';
import type { Graph } from './ir.js';
import { parseFile } from './parse/file.js';
import { outputPathFor, resolveImportFile } from './resolve/imports.js';
import { typecheck } from './check/typecheck.js';
import { validateGraph } from './validate/graph.js';

export type CompileOptions = {
  entries: string[];
  srcRoot: string;
  outRoot: string;
};

export type CompileResult = {
  diagnostics: Diagnostic[];
  outputs: { path: string; contents: string }[];
};

export function compile(options: CompileOptions): CompileResult {
  const diagnostics: Diagnostic[] = [];
  for (const entry of options.entries) {
    if (!entry.endsWith('.sea.mmd')) {
      diagnostics.push({
        code: 'SW010',
        file: path.basename(entry),
        line: 1,
        message: `Seawitch compiles .sea.mmd source only. '${path.basename(entry)}' is not executable input.`,
      });
    }
  }
  if (diagnostics.length > 0) {
    return { diagnostics, outputs: [] };
  }
  const srcRoot = path.resolve(options.srcRoot);
  const outRoot = path.resolve(options.outRoot);
  const graphs = new Map<string, Graph>();
  const dependencies = new Map<string, string[]>();
  const failed = new Set<string>();

  const load = (filePath: string, stack: string[]): void => {
    const normalized = path.normalize(path.resolve(filePath));
    if (stack.includes(normalized)) {
      const importer = stack[stack.length - 1] ?? normalized;
      const importerGraph = graphs.get(importer);
      diagnostics.push({
        code: 'SW403',
        file: importerGraph?.displayFile ?? path.basename(importer),
        line: importLine(importerGraph, normalized),
        message: `Circular Seawitch import: ${[...stack, normalized].map((item) => path.basename(item)).join(' -> ')}.`,
      });
      return;
    }
    if (graphs.has(normalized) || failed.has(normalized)) {
      return;
    }
    if (!fs.existsSync(normalized)) {
      diagnostics.push({
        code: 'SW404',
        file: path.basename(normalized),
        line: 1,
        message: `Cannot read '${normalized}'.`,
      });
      failed.add(normalized);
      return;
    }
    const parsed = parseFile(fs.readFileSync(normalized, 'utf8'), normalized, srcRoot);
    diagnostics.push(...parsed.diagnostics);
    if (!parsed.graph) {
      failed.add(normalized);
      return;
    }
    graphs.set(normalized, parsed.graph);
    const seaDependencies: string[] = [];
    for (const imported of parsed.graph.imports) {
      const resolved = resolveImportFile(normalized, imported.specifier);
      if (!resolved) {
        diagnostics.push({
          code: 'SW404',
          file: parsed.graph.displayFile,
          line: imported.loc.line,
          message: `Cannot resolve import '${imported.specifier}'.`,
        });
        continue;
      }
      if (imported.specifier.endsWith('.sea.mmd')) {
        seaDependencies.push(path.normalize(resolved));
        load(resolved, [...stack, normalized]);
      }
    }
    dependencies.set(normalized, seaDependencies);
  };

  for (const entry of options.entries) {
    load(entry, []);
  }

  const referenced = new Map<string, Set<string>>();
  for (const [filePath, graph] of graphs) {
    for (const imported of graph.imports) {
      if (!imported.specifier.endsWith('.sea.mmd')) {
        continue;
      }
      const target = graphs.get(path.normalize(path.resolve(path.dirname(filePath), imported.specifier)));
      if (!target) {
        continue;
      }
      if (imported.kind !== 'value' || imported.names.length !== 1 || imported.names[0] !== target.signature.name) {
        diagnostics.push({
          code: 'SW402',
          file: graph.displayFile,
          line: imported.loc.line,
          message: `Seawitch module '${imported.specifier}' exports only '${target.signature.name}'.`,
        });
      }
    }
    const validation = validateGraph(graph);
    diagnostics.push(...validation.diagnostics);
    referenced.set(filePath, validation.referenced);
  }

  if (diagnostics.length > 0) {
    return { diagnostics, outputs: [] };
  }

  const order = topological(graphs, dependencies);
  const emitted: EmittedFile[] = [];
  for (const filePath of order) {
    const graph = graphs.get(filePath);
    if (!graph) {
      continue;
    }
    const outputPath = outputPathFor(filePath, srcRoot, outRoot);
    const result = emitGraph(graph, outputPath, srcRoot, outRoot, referenced.get(filePath) ?? new Set());
    if ('diagnostic' in result) {
      return { diagnostics: [result.diagnostic], outputs: [] };
    }
    emitted.push(result.file);
  }

  const typeDiagnostics = typecheck(emitted, outRoot);
  if (typeDiagnostics.length > 0) {
    return { diagnostics: typeDiagnostics, outputs: [] };
  }

  for (const file of emitted) {
    fs.mkdirSync(path.dirname(file.outputPath), { recursive: true });
    const current = fs.existsSync(file.outputPath) ? fs.readFileSync(file.outputPath, 'utf8') : undefined;
    if (current !== file.contents) {
      fs.writeFileSync(file.outputPath, file.contents);
    }
  }

  return {
    diagnostics: [],
    outputs: emitted.map((file) => ({ path: file.outputPath, contents: file.contents })),
  };
}

export { formatDiagnostics };

function importLine(graph: Graph | undefined, target: string): number {
  const base = path.basename(target);
  return graph?.imports.find((imported) => imported.specifier.endsWith(base))?.loc.line ?? 1;
}

function topological(graphs: Map<string, Graph>, dependencies: Map<string, string[]>): string[] {
  const dependents = new Map<string, string[]>();
  const indegree = new Map<string, number>();
  for (const filePath of graphs.keys()) {
    dependents.set(filePath, []);
    indegree.set(filePath, 0);
  }
  for (const [filePath, deps] of dependencies) {
    for (const dependency of deps) {
      if (!graphs.has(dependency)) {
        continue;
      }
      dependents.get(dependency)?.push(filePath);
      indegree.set(filePath, (indegree.get(filePath) ?? 0) + 1);
    }
  }
  const ready = [...graphs.keys()].filter((filePath) => indegree.get(filePath) === 0).sort();
  const order: string[] = [];
  while (ready.length > 0) {
    const filePath = ready.shift();
    if (!filePath) {
      break;
    }
    order.push(filePath);
    for (const dependent of (dependents.get(filePath) ?? []).slice().sort()) {
      const next = (indegree.get(dependent) ?? 0) - 1;
      indegree.set(dependent, next);
      if (next === 0) {
        ready.push(dependent);
        ready.sort();
      }
    }
  }
  return order;
}

import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { signatureReturnsPlainBoolean } from '../check/typecheck.js';
import type { Graph, GraphNode } from '../ir.js';
import { parseFile } from '../parse/file.js';
import { expressionOf } from '../vocabulary.js';

export function booleanDecisionCallees(graph: Graph): ReadonlySet<string> {
  const names = new Set<string>();
  for (const node of graph.nodes) {
    const name = directCalleeName(node);
    if (name) {
      names.add(name);
    }
  }
  if (names.size === 0) {
    return names;
  }
  const pending = new Set(names);
  const lines: string[] = [];
  const directory = path.dirname(graph.filePath);
  for (const imported of graph.imports) {
    if (imported.kind !== 'value' || imported.specifier.endsWith('.sea.mmd')) {
      continue;
    }
    const wanted = imported.names.filter((name) => pending.has(name));
    if (wanted.length === 0) {
      continue;
    }
    lines.push(`import { ${wanted.join(', ')} } from ${JSON.stringify(imported.specifier)};`);
    for (const name of wanted) {
      lines.push(`void ${name};`);
      pending.delete(name);
    }
  }
  for (const imported of graph.imports) {
    if (imported.kind !== 'value' || !imported.specifier.endsWith('.sea.mmd')) {
      continue;
    }
    const wanted = imported.names.filter((name) => pending.has(name));
    if (wanted.length === 0) {
      continue;
    }
    const resolved = path.resolve(directory, imported.specifier);
    if (!fs.existsSync(resolved)) {
      continue;
    }
    const parsed = parseFile(fs.readFileSync(resolved, 'utf8'), resolved, path.dirname(resolved));
    const signature = parsed.graph?.signature;
    if (!signature || !wanted.includes(signature.name)) {
      continue;
    }
    for (const typeImport of parsed.graph?.imports ?? []) {
      if (typeImport.kind !== 'type') {
        continue;
      }
      const specifier = specifierFrom(directory, resolved, typeImport.specifier);
      lines.push(`import type { ${typeImport.names.join(', ')} } from ${JSON.stringify(specifier)};`);
    }
    const params = signature.params.map((parameter) => `${parameter.name}: ${parameter.typeText}`).join(', ');
    lines.push(`declare function ${signature.name}(${params}): ${signature.returnType};`);
    lines.push(`void ${signature.name};`);
    pending.delete(signature.name);
  }
  if (lines.length === 0) {
    return new Set();
  }
  return prove(path.join(directory, '__seawitch_reader_probe.ts'), `${lines.join('\n')}\n`);
}

function directCalleeName(node: GraphNode): string | undefined {
  if (node.kind !== 'decision') {
    return undefined;
  }
  if (node.exprText) {
    return callName(expressionOf(node.exprText));
  }
  return node.callee || undefined;
}

function callName(expression: ts.Expression | undefined): string | undefined {
  if (!expression) {
    return undefined;
  }
  let node: ts.Expression = expression;
  while (ts.isParenthesizedExpression(node)) {
    node = node.expression;
  }
  if (!ts.isCallExpression(node) || node.questionDotToken || node.typeArguments || !ts.isIdentifier(node.expression)) {
    return undefined;
  }
  return node.expression.text;
}

function prove(fileName: string, sourceText: string): ReadonlySet<string> {
  const options: ts.CompilerOptions = {
    strict: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    noEmit: true,
    skipLibCheck: true,
  };
  const virtual = new Map<string, string>([[path.normalize(fileName), sourceText]]);
  const host = ts.createCompilerHost(options);
  const originalGetSourceFile = host.getSourceFile.bind(host);
  const originalFileExists = host.fileExists.bind(host);
  const originalReadFile = host.readFile.bind(host);
  host.fileExists = (name) => virtual.has(path.normalize(name)) || originalFileExists(name);
  host.readFile = (name) => virtual.get(path.normalize(name)) ?? originalReadFile(name);
  host.getSourceFile = (name, languageVersionOrOptions, onError, shouldCreateNewSourceFile) => {
    const text = virtual.get(path.normalize(name));
    if (text === undefined) {
      return originalGetSourceFile(name, languageVersionOrOptions, onError, shouldCreateNewSourceFile);
    }
    const target =
      typeof languageVersionOrOptions === 'object' ? languageVersionOrOptions.languageVersion : languageVersionOrOptions;
    return ts.createSourceFile(name, text, target ?? ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  };
  const program = ts.createProgram([fileName], options, host);
  const source = program.getSourceFile(fileName);
  if (!source) {
    return new Set();
  }
  const checker = program.getTypeChecker();
  const proven = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isExpressionStatement(node) &&
      ts.isVoidExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression)
    ) {
      const name = node.expression.expression.text;
      const signatures = checker.getTypeAtLocation(node.expression.expression).getCallSignatures();
      const signature = signatures.length === 1 ? signatures[0] : undefined;
      if (signature && signatureReturnsPlainBoolean(checker, signature)) {
        proven.add(name);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return proven;
}

function specifierFrom(fromDirectory: string, ownerFile: string, specifier: string): string {
  let relative = path.relative(fromDirectory, path.resolve(path.dirname(ownerFile), specifier));
  if (!relative.startsWith('.')) {
    relative = `./${relative}`;
  }
  return relative.split(path.sep).join('/');
}

import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import type { Diagnostic } from './diagnostics.js';

export type VocabularyDirective =
  | { kind: 'file'; specifier: string; line: number }
  | { kind: 'entry'; key: string; phrase: string; line: number };

export function parseVocabularyDirective(
  body: string,
  file: string,
  line: number,
): { value: VocabularyDirective } | { diagnostic: Diagnostic } {
  const imported = /^vocabulary\s+(['"])(\.[^'"]+)\1\s*$/.exec(body);
  if (imported) {
    const specifier = imported[2] ?? '';
    if (!specifier.endsWith('.json')) {
      return { diagnostic: invalid(file, line, `Vocabulary import '${specifier}' must be a relative .json file.`) };
    }
    return { value: { kind: 'file', specifier, line } };
  }
  const entry = /^vocabulary\s+(.+?)\s=\s(\S[\s\S]*)$/.exec(body);
  if (!entry) {
    return {
      diagnostic: invalid(
        file,
        line,
        "A vocabulary directive is 'key = phrase' or a file \"./vocabulary.json\".",
      ),
    };
  }
  return { value: { kind: 'entry', key: (entry[1] ?? '').trim(), phrase: (entry[2] ?? '').trim(), line } };
}

export function resolveVocabulary(
  directives: VocabularyDirective[],
  sourceFile: string,
  displayFile: string,
): { phrases: Map<string, string>; diagnostics: Diagnostic[] } {
  const phrases = new Map<string, string>();
  const diagnostics: Diagnostic[] = [];
  for (const directive of directives) {
    if (directive.kind === 'file') {
      loadFile(directive.specifier, directive.line, sourceFile, displayFile, phrases, diagnostics);
      continue;
    }
    definePhrase(directive.key, directive.phrase, directive.line, displayFile, phrases, diagnostics);
  }
  return { phrases, diagnostics };
}

export function structuralKey(node: ts.Node): string | undefined {
  if (ts.isParenthesizedExpression(node)) {
    return structuralKey(node.expression);
  }
  if (ts.isIdentifier(node)) {
    return `path:${node.text}`;
  }
  if (ts.isPropertyAccessExpression(node)) {
    if (node.questionDotToken || !ts.isIdentifier(node.name)) {
      return undefined;
    }
    const head = structuralKey(node.expression);
    if (!head?.startsWith('path:')) {
      return undefined;
    }
    return `${head}.${node.name.text}`;
  }
  if (node.kind === ts.SyntaxKind.TrueKeyword) {
    return 'lit:boolean:true';
  }
  if (node.kind === ts.SyntaxKind.FalseKeyword) {
    return 'lit:boolean:false';
  }
  if (node.kind === ts.SyntaxKind.NullKeyword) {
    return 'lit:null';
  }
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return `lit:string:${node.text}`;
  }
  if (ts.isNumericLiteral(node)) {
    return `lit:number:${node.text}`;
  }
  if (
    ts.isPrefixUnaryExpression(node) &&
    node.operator === ts.SyntaxKind.MinusToken &&
    ts.isNumericLiteral(node.operand)
  ) {
    return `lit:number:-${node.operand.text}`;
  }
  return undefined;
}

export function literalPhrase(
  vocabulary: ReadonlyMap<string, string>,
  literal: ts.Node,
  subject?: ts.Node,
): string | undefined {
  const key = structuralKey(literal);
  if (!key?.startsWith('lit:')) {
    return undefined;
  }
  if (subject) {
    const subjectKey = structuralKey(subject);
    if (subjectKey?.startsWith('path:')) {
      const contextual = vocabulary.get(`when:${subjectKey}|${key}`);
      if (contextual) {
        return contextual;
      }
    }
  }
  return vocabulary.get(key);
}

export function expressionOf(text: string): ts.Expression | undefined {
  const source = ts.createSourceFile('expression.ts', `(${text}\n);`, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const syntaxErrors = (source as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics;
  if ((syntaxErrors?.length ?? 0) > 0 || source.statements.length !== 1) {
    return undefined;
  }
  const statement = source.statements[0];
  if (!statement || !ts.isExpressionStatement(statement) || !ts.isParenthesizedExpression(statement.expression)) {
    return undefined;
  }
  return statement.expression.expression;
}

function loadFile(
  specifier: string,
  line: number,
  sourceFile: string,
  displayFile: string,
  phrases: Map<string, string>,
  diagnostics: Diagnostic[],
): void {
  const resolved = path.resolve(path.dirname(sourceFile), specifier);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    diagnostics.push(invalid(displayFile, line, `Cannot read vocabulary '${specifier}'.`));
    return;
  }
  const text = fs.readFileSync(resolved, 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    diagnostics.push(invalid(displayFile, line, `Vocabulary file '${specifier}' is not valid JSON.`));
    return;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    diagnostics.push(invalid(displayFile, line, `Vocabulary file '${specifier}' must be a JSON object of strings.`));
    return;
  }
  const keys = jsonKeys(text);
  if (keys.length !== new Set(keys).size) {
    diagnostics.push(invalid(displayFile, line, `Vocabulary file '${specifier}' repeats a key.`));
    return;
  }
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value !== 'string') {
      diagnostics.push(invalid(displayFile, line, `Vocabulary key '${key}' in '${specifier}' must be a string.`));
      continue;
    }
    definePhrase(key, value, line, displayFile, phrases, diagnostics);
  }
}

function storageKey(expression: ts.Expression): string | undefined {
  const unwrapped = unwrap(expression);
  if (ts.isElementAccessExpression(unwrapped)) {
    if (unwrapped.questionDotToken || !unwrapped.argumentExpression) {
      return undefined;
    }
    const subject = structuralKey(unwrapped.expression);
    const literal = structuralKey(unwrapped.argumentExpression);
    if (!subject?.startsWith('path:') || !literal?.startsWith('lit:')) {
      return undefined;
    }
    return `when:${subject}|${literal}`;
  }
  return structuralKey(unwrapped);
}

function unwrap(node: ts.Node): ts.Node {
  return ts.isParenthesizedExpression(node) ? unwrap(node.expression) : node;
}

function definePhrase(
  key: string,
  phrase: string,
  line: number,
  file: string,
  phrases: Map<string, string>,
  diagnostics: Diagnostic[],
): void {
  const problem = phraseProblem(phrase);
  if (problem) {
    diagnostics.push(invalid(file, line, problem));
    return;
  }
  const expression = expressionOf(key);
  const structural = expression ? storageKey(expression) : undefined;
  if (!expression || !structural) {
    diagnostics.push(
      invalid(
        file,
        line,
        `Vocabulary key '${key}' must be an identifier, a property path, a literal, or subject['literal'].`,
      ),
    );
    return;
  }
  const trimmed = phrase.trim();
  const previous = phrases.get(structural);
  if (previous !== undefined) {
    const message =
      previous === trimmed
        ? `Vocabulary key '${key}' repeats an earlier mapping.`
        : `Vocabulary key '${key}' is '${trimmed}' here and '${previous}' in an earlier mapping.`;
    diagnostics.push(invalid(file, line, message));
    return;
  }
  phrases.set(structural, trimmed);
}

function phraseProblem(phrase: string): string | undefined {
  if (phrase.trim() === '') {
    return 'A vocabulary phrase must not be empty.';
  }
  if (/[\n\r\u2028\u2029]/.test(phrase)) {
    return 'A vocabulary phrase must be a single line.';
  }
  return undefined;
}

function jsonKeys(text: string): string[] {
  return [...text.matchAll(/"(?:\\.|[^"\\])*"(?=\s*:)/g)].map((match) => JSON.parse(match[0]) as string);
}

function invalid(file: string, line: number, message: string): Diagnostic {
  return { code: 'SW018', file, line, message };
}

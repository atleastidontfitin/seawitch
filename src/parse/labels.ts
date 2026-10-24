import type { Expr, Literal, Location } from '../ir.js';
import { identifierProblem } from './identifiers.js';

type Failure = { message: string };

export function parseCallLabel(
  label: string,
  loc: Location,
): { callee: string; args: Expr[] } | Failure {
  const match = /^call\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(([\s\S]*)\)\s*$/.exec(label);
  if (!match) {
    return { message: `Call label must look like call name(arg, ...). Received '${label}'.` };
  }
  const callee = match[1] ?? '';
  const problem = identifierProblem(callee);
  if (problem) {
    return { message: problem };
  }
  const args = splitArguments(match[2] ?? '');
  if ('message' in args) {
    return args;
  }
  const parsed: Expr[] = [];
  for (const argument of args.values) {
    const expr = parseExpr(argument, loc);
    if ('message' in expr) {
      return expr;
    }
    parsed.push(expr.value);
  }
  return { callee, args: parsed };
}

export function parseReturnLabel(label: string, loc: Location): { value: Expr } | Failure {
  const match = /^return\s+([\s\S]+)$/.exec(label);
  if (!match) {
    return { message: `Return label must look like return value. Received '${label}'.` };
  }
  const expr = parseExpr(match[1].trim(), loc);
  if ('message' in expr) {
    return expr;
  }
  return { value: expr.value };
}

function splitArguments(inner: string): { values: string[] } | Failure {
  if (inner.trim() === '') {
    return { values: [] };
  }
  const values: string[] = [];
  let current = '';
  let inString = false;
  let escaped = false;
  for (const char of inner) {
    if (inString) {
      current += char;
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char === "'") {
        inString = false;
      }
      continue;
    }
    if (char === "'") {
      inString = true;
      current += char;
      continue;
    }
    if (char === ',') {
      if (current.trim() === '') {
        return { message: 'Call arguments cannot include an empty entry.' };
      }
      values.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  if (inString) {
    return { message: 'A string literal is missing its closing quote.' };
  }
  if (current.trim() === '') {
    return { message: 'Call arguments cannot include a trailing comma.' };
  }
  values.push(current.trim());
  return { values };
}

function parseExpr(text: string, loc: Location): { value: Expr } | Failure {
  if (text === 'true' || text === 'false') {
    return { value: { kind: 'literal', literal: { kind: 'boolean', value: text === 'true' }, loc } };
  }
  if (text === 'null') {
    return { value: { kind: 'literal', literal: { kind: 'null' }, loc } };
  }
  if (text === 'undefined') {
    return { message: "'undefined' is not a Seawitch literal." };
  }
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text)) {
    const literal: Literal = { kind: 'number', value: Number(text), raw: text };
    return { value: { kind: 'literal', literal, loc } };
  }
  if (text.startsWith("'")) {
    const parsed = parseString(text);
    if ('message' in parsed) {
      return parsed;
    }
    return { value: { kind: 'literal', literal: { kind: 'string', value: parsed.value }, loc } };
  }
  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(text)) {
    return { value: { kind: 'ref', name: text, loc } };
  }
  return { message: `Unsupported value '${text}'. Use a name or a literal.` };
}

function parseString(text: string): { value: string } | Failure {
  if (!text.endsWith("'") || text.length < 2) {
    return { message: `Invalid string literal '${text}'.` };
  }
  let value = '';
  for (let index = 1; index < text.length - 1; index += 1) {
    const char = text[index];
    if (char === '\\') {
      const next = text[index + 1];
      if (next !== '\\' && next !== "'") {
        return { message: 'String literals may only escape \\\\ and \\\'.' };
      }
      value += next;
      index += 1;
      continue;
    }
    if (char === "'") {
      return { message: `Invalid string literal '${text}'.` };
    }
    value += char;
  }
  return { value };
}

const TYPESCRIPT_RESERVED = new Set([
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'enum',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'function',
  'if',
  'import',
  'in',
  'instanceof',
  'let',
  'new',
  'null',
  'return',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'typeof',
  'var',
  'void',
  'while',
  'with',
  'yield',
  'implements',
  'interface',
  'package',
  'private',
  'protected',
  'public',
  'static',
]);

const MERMAID_RESERVED = new Set([
  'call',
  'class',
  'classDef',
  'click',
  'default',
  'direction',
  'end',
  'flowchart',
  'graph',
  'href',
  'interpolate',
  'linkStyle',
  'style',
  'subgraph',
]);

export function identifierProblem(name: string): string | undefined {
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) {
    return `'${name}' is not a TypeScript identifier.`;
  }
  if (TYPESCRIPT_RESERVED.has(name)) {
    return `'${name}' is a reserved TypeScript word.`;
  }
  if (MERMAID_RESERVED.has(name)) {
    return `'${name}' is reserved by Mermaid flowchart syntax.`;
  }
  return undefined;
}

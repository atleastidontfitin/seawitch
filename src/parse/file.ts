import path from 'node:path';
import type { Diagnostic } from '../diagnostics.js';
import type { Direction, Edge, Graph, GraphNode, ImportDecl, Location, Signature } from '../ir.js';
import { parseExpression } from './expression.js';
import { identifierProblem } from './identifiers.js';
import { parseCallLabel, parseReturnLabel } from './labels.js';
import { parseFunctionDirective, parseImportDirective } from './signature.js';

type RawEndpoint = {
  id: string;
  shape?: 'rect' | 'diamond';
  label?: string;
  line: number;
};

type RawEdge = {
  from: RawEndpoint;
  to: RawEndpoint;
  label?: 'true' | 'false';
  line: number;
};

export function displayPath(filePath: string, srcRoot: string): string {
  const relative = path.relative(srcRoot, filePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return path.basename(filePath);
  }
  return relative.split(path.sep).join('/');
}

export function parseFile(source: string, filePath: string, srcRoot: string): { graph?: Graph; diagnostics: Diagnostic[] } {
  const displayFile = displayPath(filePath, srcRoot);
  const diagnostics: Diagnostic[] = [];
  const lines = source.replace(/^\uFEFF/, '').split(/\r?\n/);
  let direction: Direction | undefined;
  let seenHeader = false;
  let sawFunction = false;
  let signature: Signature | undefined;
  const imports: ImportDecl[] = [];
  const edges: RawEdge[] = [];
  const definitions = new Map<string, { shape: 'rect' | 'diamond'; label: string; line: number }>();

  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const line = lines[index] ?? '';
    if (line.trim() === '') {
      continue;
    }
    if (!seenHeader) {
      const header = /^\s*flowchart\s+(TD|TB|LR|RL|BT)\s*;?\s*$/.exec(line);
      if (header) {
        direction = header[1] as Direction;
        seenHeader = true;
        continue;
      }
      if (/^\s*%%/.test(line) && !/^\s*%%\s*seawitch\s*:/.test(line)) {
        continue;
      }
      diagnostics.push({
        code: 'SW010',
        file: displayFile,
        line: lineNumber,
        message: 'The first statement must be a flowchart header: flowchart TD|TB|LR|RL|BT.',
      });
      return { diagnostics };
    }
    const directive = /^\s*%%\s*seawitch\s*:\s*(.*?)\s*$/.exec(line);
    if (directive) {
      const body = directive[1] ?? '';
      if (body.startsWith('function')) {
        sawFunction = true;
        if (signature) {
          diagnostics.push({
            code: 'SW011',
            file: displayFile,
            line: lineNumber,
            message: 'A Seawitch file declares exactly one function.',
          });
          continue;
        }
        const parsed = parseFunctionDirective(body, displayFile, lineNumber);
        if ('diagnostic' in parsed) {
          diagnostics.push(parsed.diagnostic);
        } else {
          signature = parsed.value;
        }
        continue;
      }
      if (body.startsWith('import')) {
        const parsed = parseImportDirective(body, displayFile, lineNumber);
        if ('diagnostic' in parsed) {
          diagnostics.push(parsed.diagnostic);
        } else {
          imports.push(parsed.value);
        }
        continue;
      }
      diagnostics.push({
        code: 'SW012',
        file: displayFile,
        line: lineNumber,
        message: `Unknown seawitch directive '${body}'.`,
      });
      continue;
    }
    if (/^\s*%%/.test(line)) {
      continue;
    }
    const parsedEdge = parseEdge(line, lineNumber, displayFile);
    if ('diagnostic' in parsedEdge) {
      diagnostics.push(parsedEdge.diagnostic);
      continue;
    }
    const noted = noteEndpoint(parsedEdge.edge.from, definitions, displayFile, diagnostics);
    if (noted) {
      continue;
    }
    noteEndpoint(parsedEdge.edge.to, definitions, displayFile, diagnostics);
    edges.push(parsedEdge.edge);
  }

  if (!direction) {
    diagnostics.push({
      code: 'SW010',
      file: displayFile,
      line: 1,
      message: 'The file is missing a flowchart header.',
    });
    return { diagnostics };
  }
  if (!signature && !sawFunction) {
    diagnostics.push({
      code: 'SW011',
      file: displayFile,
      line: 1,
      message: 'The file is missing a seawitch function directive.',
    });
  }
  if (diagnostics.length > 0 || !signature) {
    return { diagnostics };
  }

  for (const edge of edges) {
    for (const endpoint of [edge.from, edge.to]) {
      if (!endpoint.shape && !definitions.has(endpoint.id)) {
        diagnostics.push({
          code: 'SW101',
          file: displayFile,
          line: endpoint.line,
          message: `Node '${endpoint.id}' has no shape and label.`,
        });
      }
    }
  }
  if (diagnostics.length > 0) {
    return { diagnostics };
  }

  const nodes: GraphNode[] = [];
  for (const [id, definition] of definitions) {
    const built = buildNode(id, definition, displayFile);
    if ('code' in built) {
      diagnostics.push(built);
    } else {
      nodes.push(built);
    }
  }
  if (!nodes.some((node) => node.kind === 'entry')) {
    diagnostics.push({
      code: 'SW101',
      file: displayFile,
      line: 1,
      message: "The entry node start[\"start\"] is missing.",
    });
  }
  if (diagnostics.length > 0) {
    return { diagnostics };
  }

  const claimed = new Map<string, string>();
  const claim = (name: string, role: string, line: number) => {
    const problem = identifierProblem(name);
    if (problem) {
      diagnostics.push({ code: 'SW015', file: displayFile, line, message: problem });
      return;
    }
    const previous = claimed.get(name);
    if (previous) {
      diagnostics.push({
        code: 'SW015',
        file: displayFile,
        line,
        message: `'${name}' is used as both ${previous} and ${role}.`,
      });
      return;
    }
    claimed.set(name, role);
  };
  claim(signature.name, 'the function name', signature.loc.line);
  for (const parameter of signature.params) {
    claim(parameter.name, 'a parameter', parameter.loc.line);
  }
  for (const imported of imports) {
    for (const name of imported.names) {
      claim(name, 'an import', imported.loc.line);
    }
  }
  for (const node of nodes) {
    claim(node.id, 'a node id', node.loc.line);
  }
  if (diagnostics.length > 0) {
    return { diagnostics };
  }

  const graphEdges: Edge[] = edges.map((edge) => ({
    from: edge.from.id,
    to: edge.to.id,
    label: edge.label,
    loc: { line: edge.line, column: 1 },
  }));
  return {
    diagnostics,
    graph: {
      filePath,
      displayFile,
      direction,
      signature,
      imports,
      nodes,
      edges: graphEdges,
    },
  };
}

function noteEndpoint(
  endpoint: RawEndpoint,
  definitions: Map<string, { shape: 'rect' | 'diamond'; label: string; line: number }>,
  file: string,
  diagnostics: Diagnostic[],
): boolean {
  if (!endpoint.shape || endpoint.label === undefined) {
    return false;
  }
  const existing = definitions.get(endpoint.id);
  if (!existing) {
    definitions.set(endpoint.id, { shape: endpoint.shape, label: endpoint.label, line: endpoint.line });
    return false;
  }
  if (existing.shape !== endpoint.shape || existing.label !== endpoint.label) {
    diagnostics.push({
      code: 'SW109',
      file,
      line: endpoint.line,
      nodeId: endpoint.id,
      message: `Node '${endpoint.id}' is defined more than once with conflicting shapes or labels.`,
    });
    return true;
  }
  return false;
}

function buildNode(
  id: string,
  definition: { shape: 'rect' | 'diamond'; label: string; line: number },
  file: string,
): GraphNode | Diagnostic {
  const loc: Location = { line: definition.line, column: 1 };
  if (definition.shape === 'diamond') {
    return buildDecision(id, definition.label, file, loc);
  }
  if (definition.label === 'start') {
    if (id !== 'start') {
      return {
        code: 'SW101',
        file,
        line: definition.line,
        nodeId: id,
        message: 'Only the node id start may use the label start.',
      };
    }
    return { kind: 'entry', id: 'start', loc };
  }
  if (/^return(?:\s|$)/.test(definition.label)) {
    return buildReturn(id, definition.label, file, loc);
  }
  if (/^call(?:\s|$)/.test(definition.label)) {
    const call = parseCallLabel(definition.label, loc);
    if ('message' in call) {
      return { code: 'SW014', file, line: definition.line, nodeId: id, message: call.message };
    }
    return { kind: 'call', id, callee: call.callee, args: call.args, loc };
  }
  return buildExpression(id, definition.label, file, loc, 'call');
}

function buildDecision(id: string, label: string, file: string, loc: Location): GraphNode | Diagnostic {
  if (/^call(?:\s|$)/.test(label)) {
    const call = parseCallLabel(label, loc);
    if ('message' in call) {
      return { code: 'SW014', file, line: loc.line, nodeId: id, message: call.message };
    }
    return { kind: 'decision', id, callee: call.callee, args: call.args, loc };
  }
  return buildExpression(id, label, file, loc, 'decision');
}

function buildReturn(id: string, label: string, file: string, loc: Location): GraphNode | Diagnostic {
  const legacy = parseReturnLabel(label, loc);
  if (!('message' in legacy)) {
    return { kind: 'return', id, value: legacy.value, loc };
  }
  const operand = /^return\s+([\s\S]+)$/.exec(label)?.[1]?.trim();
  if (!operand) {
    return { code: 'SW014', file, line: loc.line, nodeId: id, message: legacy.message };
  }
  const parsed = parseExpression(operand, loc);
  if ('message' in parsed) {
    return { code: 'SW016', file, line: loc.line, nodeId: id, message: parsed.message };
  }
  return {
    kind: 'return',
    id,
    value: { kind: 'ref', name: id, loc },
    exprText: parsed.value.text,
    exprRefs: parsed.value.refs,
    callees: parsed.value.callees,
    loc,
  };
}

function buildExpression(
  id: string,
  label: string,
  file: string,
  loc: Location,
  kind: 'call' | 'decision',
): GraphNode | Diagnostic {
  const parsed = parseExpression(label, loc);
  if ('message' in parsed) {
    return { code: 'SW016', file, line: loc.line, nodeId: id, message: parsed.message };
  }
  return {
    kind,
    id,
    callee: '',
    args: [],
    exprText: parsed.value.text,
    exprRefs: parsed.value.refs,
    callees: parsed.value.callees,
    loc,
  };
}

class Cursor {
  index = 0;
  text: string;

  constructor(text: string) {
    this.text = text;
  }

  skipWhitespace(): void {
    while (this.index < this.text.length && (this.text[this.index] === ' ' || this.text[this.index] === '\t')) {
      this.index += 1;
    }
  }

  eat(token: string): boolean {
    if (this.text.startsWith(token, this.index)) {
      this.index += token.length;
      return true;
    }
    return false;
  }

  readIdentifier(): string | undefined {
    const match = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(this.text.slice(this.index));
    if (!match) {
      return undefined;
    }
    this.index += match[0].length;
    return match[0];
  }

  readUntil(closer: string): string | undefined {
    const end = this.text.indexOf(closer, this.index);
    if (end < 0) {
      return undefined;
    }
    const value = this.text.slice(this.index, end);
    this.index = end + closer.length;
    return value;
  }
}

function parseEdge(line: string, lineNumber: number, file: string): { edge: RawEdge } | { diagnostic: Diagnostic } {
  let text = line.trim();
  if (text.endsWith(';')) {
    text = text.slice(0, -1).trimEnd();
  }
  const cursor = new Cursor(text);
  const from = parseEndpoint(cursor, lineNumber);
  if (!from) {
    return unsupported(file, lineNumber);
  }
  cursor.skipWhitespace();
  if (!cursor.eat('-->')) {
    return unsupported(file, lineNumber);
  }
  cursor.skipWhitespace();
  let label: 'true' | 'false' | undefined;
  if (cursor.eat('|')) {
    const end = cursor.text.indexOf('|', cursor.index);
    if (end < 0) {
      return unsupported(file, lineNumber);
    }
    const rawLabel = cursor.text.slice(cursor.index, end);
    if (rawLabel !== 'true' && rawLabel !== 'false') {
      return {
        diagnostic: {
          code: 'SW013',
          file,
          line: lineNumber,
          message: `Edge label must be "true" or "false". Received '${rawLabel}'.`,
        },
      };
    }
    label = rawLabel;
    cursor.index = end + 1;
    cursor.skipWhitespace();
  }
  const to = parseEndpoint(cursor, lineNumber);
  if (!to) {
    return unsupported(file, lineNumber);
  }
  cursor.skipWhitespace();
  if (cursor.index !== cursor.text.length) {
    return unsupported(file, lineNumber);
  }
  return { edge: { from, to, label, line: lineNumber } };
}

function parseEndpoint(cursor: Cursor, line: number): RawEndpoint | undefined {
  const id = cursor.readIdentifier();
  if (!id) {
    return undefined;
  }
  if (cursor.eat('["')) {
    const label = cursor.readUntil('"]');
    if (label === undefined) {
      return undefined;
    }
    return { id, shape: 'rect', label, line };
  }
  if (cursor.eat('{"')) {
    const label = cursor.readUntil('"}');
    if (label === undefined) {
      return undefined;
    }
    return { id, shape: 'diamond', label, line };
  }
  return { id, line };
}

function unsupported(file: string, line: number): { diagnostic: Diagnostic } {
  return {
    diagnostic: {
      code: 'SW013',
      file,
      line,
      message: 'Unsupported flowchart syntax. Each line must be one labeled or unlabeled --> edge.',
    },
  };
}

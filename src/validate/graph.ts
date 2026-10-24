import type { Diagnostic } from '../diagnostics.js';
import type { Expr, Graph, GraphNode } from '../ir.js';

export type Validation = {
  diagnostics: Diagnostic[];
  referenced: Set<string>;
};

export function validateGraph(graph: Graph): Validation {
  const diagnostics: Diagnostic[] = [];
  const nodes = new Map<string, GraphNode>(graph.nodes.map((node) => [node.id, node]));
  const outgoing = new Map<string, Graph['edges']>();
  const incoming = new Map<string, number>();
  for (const node of graph.nodes) {
    outgoing.set(node.id, []);
    incoming.set(node.id, 0);
  }
  for (const edge of graph.edges) {
    if (!nodes.has(edge.from) || !nodes.has(edge.to)) {
      diagnostics.push({
        code: 'SW101',
        file: graph.displayFile,
        line: edge.loc.line,
        message: `Edge '${edge.from}' -> '${edge.to}' references a missing node.`,
      });
      continue;
    }
    outgoing.get(edge.from)?.push(edge);
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
  }

  for (const node of graph.nodes) {
    const edges = outgoing.get(node.id) ?? [];
    if (node.kind === 'entry') {
      if ((incoming.get(node.id) ?? 0) > 0) {
        diagnostics.push({
          code: 'SW101',
          file: graph.displayFile,
          line: node.loc.line,
          nodeId: node.id,
          message: 'The entry node must not have incoming edges.',
        });
      }
      if (edges.length !== 1 || edges[0]?.label) {
        diagnostics.push({
          code: 'SW101',
          file: graph.displayFile,
          line: node.loc.line,
          nodeId: node.id,
          message: 'The entry node must have exactly one unlabeled outgoing edge.',
        });
      }
    } else if (node.kind === 'call') {
      if (edges.length !== 1 || edges[0]?.label) {
        diagnostics.push({
          code: 'SW102',
          file: graph.displayFile,
          line: node.loc.line,
          nodeId: node.id,
          message: 'A call node must have exactly one unlabeled outgoing edge.',
        });
      }
    } else if (node.kind === 'decision') {
      const labels = new Set(edges.map((edge) => edge.label));
      if (!labels.has('true')) {
        diagnostics.push({
          code: 'SW104',
          file: graph.displayFile,
          line: node.loc.line,
          nodeId: node.id,
          message: "Decision is missing a 'true' outgoing edge.",
        });
      }
      if (!labels.has('false')) {
        diagnostics.push({
          code: 'SW104',
          file: graph.displayFile,
          line: node.loc.line,
          nodeId: node.id,
          message: "Decision is missing a 'false' outgoing edge.",
        });
      }
      if (edges.length !== 2 && labels.has('true') && labels.has('false')) {
        diagnostics.push({
          code: 'SW104',
          file: graph.displayFile,
          line: node.loc.line,
          nodeId: node.id,
          message: "A decision must have exactly one 'true' edge and one 'false' edge.",
        });
      }
    } else if (edges.length > 0) {
      diagnostics.push({
        code: 'SW105',
        file: graph.displayFile,
        line: node.loc.line,
        nodeId: node.id,
        message: 'A return node must not have outgoing edges.',
      });
    }
  }

  const valueImports = new Set(
    graph.imports.filter((imported) => imported.kind === 'value').flatMap((imported) => imported.names),
  );
  for (const node of graph.nodes) {
    if ((node.kind === 'call' || node.kind === 'decision') && !valueImports.has(node.callee)) {
      diagnostics.push({
        code: 'SW401',
        file: graph.displayFile,
        line: node.loc.line,
        nodeId: node.id,
        message: `Unknown function '${node.callee}'. Import it before calling it.`,
      });
    }
  }

  if (hasCycle(graph)) {
    diagnostics.push({
      code: 'SW108',
      file: graph.displayFile,
      line: graph.nodes[0]?.loc.line ?? 1,
      message: 'Flowchart contains a cycle.',
    });
  }

  const reachable = reachableFromStart(graph);
  for (const node of graph.nodes) {
    if (!reachable.has(node.id)) {
      diagnostics.push({
        code: 'SW106',
        file: graph.displayFile,
        line: node.loc.line,
        nodeId: node.id,
        message: `Node '${node.id}' is not reachable from start.`,
      });
    }
  }

  if (!diagnostics.some((diagnostic) => diagnostic.code === 'SW108')) {
    const returns = pathsReachingReturn(graph, nodes);
    for (const node of graph.nodes) {
      if (!reachable.has(node.id) || node.kind === 'return') {
        continue;
      }
      if (!returns.get(node.id)) {
        diagnostics.push({
          code: 'SW107',
          file: graph.displayFile,
          line: node.loc.line,
          nodeId: node.id,
          message: `A path from '${node.id}' does not reach a return node.`,
        });
      }
    }
  }

  const parameters = new Set(graph.signature.params.map((parameter) => parameter.name));
  const dominators = computeDominators(graph);
  const referenced = new Set<string>();
  for (const node of graph.nodes) {
    const expressions = expressionsOf(node);
    for (const expression of expressions) {
      if (expression.kind !== 'ref') {
        continue;
      }
      if (parameters.has(expression.name)) {
        continue;
      }
      const producer = nodes.get(expression.name);
      if (!producer || (producer.kind !== 'call' && producer.kind !== 'decision')) {
        diagnostics.push({
          code: 'SW203',
          file: graph.displayFile,
          line: node.loc.line,
          nodeId: node.id,
          message: `Unknown value '${expression.name}'.`,
        });
        continue;
      }
      referenced.add(expression.name);
      const dominated = dominators.get(node.id);
      if (expression.name === node.id || !dominated?.has(expression.name)) {
        diagnostics.push({
          code: 'SW203',
          file: graph.displayFile,
          line: node.loc.line,
          nodeId: node.id,
          message: `Value '${expression.name}' may not be defined on all paths to this node.`,
        });
      }
    }
  }

  return { diagnostics, referenced };
}

function expressionsOf(node: GraphNode): Expr[] {
  if (node.kind === 'call' || node.kind === 'decision') {
    return node.args;
  }
  if (node.kind === 'return') {
    return [node.value];
  }
  return [];
}

function successors(graph: Graph, id: string): string[] {
  return graph.edges.filter((edge) => edge.from === id).map((edge) => edge.to);
}

function hasCycle(graph: Graph): boolean {
  const color = new Map<string, 'white' | 'gray' | 'black'>();
  const visit = (id: string): boolean => {
    color.set(id, 'gray');
    for (const next of successors(graph, id)) {
      const state = color.get(next) ?? 'white';
      if (state === 'gray' || (state === 'white' && visit(next))) {
        return true;
      }
    }
    color.set(id, 'black');
    return false;
  };
  for (const node of graph.nodes) {
    if ((color.get(node.id) ?? 'white') === 'white' && visit(node.id)) {
      return true;
    }
  }
  return false;
}

function reachableFromStart(graph: Graph): Set<string> {
  const seen = new Set<string>();
  const queue = ['start'];
  while (queue.length > 0) {
    const id = queue.shift();
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    queue.push(...successors(graph, id));
  }
  return seen;
}

function pathsReachingReturn(graph: Graph, nodes: Map<string, GraphNode>): Map<string, boolean> {
  const state = new Map<string, 'visiting' | boolean>();
  const visit = (id: string): boolean => {
    const known = state.get(id);
    if (known === true || known === false) {
      return known;
    }
    if (known === 'visiting') {
      return false;
    }
    const node = nodes.get(id);
    if (!node) {
      state.set(id, false);
      return false;
    }
    if (node.kind === 'return') {
      state.set(id, true);
      return true;
    }
    const next = successors(graph, id);
    if (next.length === 0) {
      state.set(id, false);
      return false;
    }
    state.set(id, 'visiting');
    const reaches = next.every((target) => visit(target));
    state.set(id, reaches);
    return reaches;
  };
  for (const node of graph.nodes) {
    visit(node.id);
  }
  const result = new Map<string, boolean>();
  for (const [id, value] of state) {
    result.set(id, value === true);
  }
  return result;
}

function computeDominators(graph: Graph): Map<string, Set<string>> {
  const ids = graph.nodes.map((node) => node.id);
  const predecessors = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const edge of graph.edges) {
    predecessors.get(edge.to)?.push(edge.from);
  }
  const dominators = new Map<string, Set<string>>();
  dominators.set('start', new Set(['start']));
  for (const id of ids) {
    if (id !== 'start') {
      dominators.set(id, new Set(ids));
    }
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of ids) {
      if (id === 'start') {
        continue;
      }
      const preds = predecessors.get(id) ?? [];
      let next: Set<string>;
      if (preds.length === 0) {
        next = new Set([id]);
      } else {
        next = new Set(dominators.get(preds[0] ?? ''));
        for (const predecessor of preds.slice(1)) {
          next = intersect(next, dominators.get(predecessor) ?? new Set());
        }
        next.add(id);
      }
      const previous = dominators.get(id) ?? new Set();
      if (!sameSet(previous, next)) {
        dominators.set(id, next);
        changed = true;
      }
    }
  }
  return dominators;
}

function intersect(left: Set<string>, right: Set<string>): Set<string> {
  const result = new Set<string>();
  for (const value of left) {
    if (right.has(value)) {
      result.add(value);
    }
  }
  return result;
}

function sameSet(left: Set<string>, right: Set<string>): boolean {
  if (left.size !== right.size) {
    return false;
  }
  for (const value of left) {
    if (!right.has(value)) {
      return false;
    }
  }
  return true;
}

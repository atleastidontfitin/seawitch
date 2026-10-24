import type { Graph } from '../ir.js';

/** Synthetic exit. Every return reaches it, so every node that can finish has a postdominator. */
export const EXIT = '\u0000exit';

/**
 * Immediate postdominator of each node, including the synthetic exit.
 * The closest postdominator is the one whose own postdominator set is largest:
 * it contains every later postdominator.
 */
export function immediatePostdominators(graph: Graph): Map<string, string> {
  const postdominators = computePostdominators(graph);
  const immediate = new Map<string, string>();
  for (const [id, nodes] of postdominators) {
    if (id === EXIT) {
      continue;
    }
    let closest: string | undefined;
    let closestSize = -1;
    for (const candidate of nodes) {
      if (candidate === id) {
        continue;
      }
      const size = postdominators.get(candidate)?.size ?? 0;
      if (size > closestSize) {
        closest = candidate;
        closestSize = size;
      }
    }
    if (closest) {
      immediate.set(id, closest);
    }
  }
  return immediate;
}

function computePostdominators(graph: Graph): Map<string, Set<string>> {
  const successors = new Map<string, string[]>();
  for (const node of graph.nodes) {
    successors.set(node.id, []);
  }
  successors.set(EXIT, []);
  for (const edge of graph.edges) {
    successors.get(edge.from)?.push(edge.to);
  }
  for (const node of graph.nodes) {
    if (node.kind === 'return') {
      successors.get(node.id)?.push(EXIT);
    }
  }

  const ids = [...successors.keys()];
  const everyone = new Set(ids);
  const postdominators = new Map<string, Set<string>>();
  postdominators.set(EXIT, new Set([EXIT]));
  for (const id of ids) {
    if (id !== EXIT) {
      postdominators.set(id, new Set(everyone));
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const id of ids) {
      if (id === EXIT) {
        continue;
      }
      const nextIds = successors.get(id) ?? [];
      let next: Set<string>;
      if (nextIds.length === 0) {
        next = new Set([id]);
      } else {
        next = new Set(postdominators.get(nextIds[0] ?? '') ?? []);
        for (const successor of nextIds.slice(1)) {
          next = intersect(next, postdominators.get(successor) ?? new Set());
        }
        next.add(id);
      }
      const previous = postdominators.get(id) ?? new Set();
      if (!sameSet(previous, next)) {
        postdominators.set(id, next);
        changed = true;
      }
    }
  }
  return postdominators;
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

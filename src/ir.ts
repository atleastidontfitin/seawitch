export type Location = {
  line: number;
  column: number;
};

export type Literal =
  | { kind: 'string'; value: string }
  | { kind: 'number'; value: number; raw: string }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'null' };

export type Expr =
  | { kind: 'ref'; name: string; loc: Location }
  | { kind: 'literal'; literal: Literal; loc: Location };

export type GraphNode =
  | { kind: 'entry'; id: 'start'; loc: Location }
  | { kind: 'call'; id: string; callee: string; args: Expr[]; loc: Location }
  | { kind: 'decision'; id: string; callee: string; args: Expr[]; loc: Location }
  | { kind: 'return'; id: string; value: Expr; loc: Location };

export type Edge = {
  from: string;
  to: string;
  label?: 'true' | 'false';
  loc: Location;
};

export type ImportDecl = {
  kind: 'value' | 'type';
  names: string[];
  specifier: string;
  loc: Location;
};

export type Signature = {
  name: string;
  params: { name: string; typeText: string; loc: Location }[];
  returnType: string;
  loc: Location;
};

export type Direction = 'TD' | 'TB' | 'LR' | 'RL' | 'BT';

export type Graph = {
  filePath: string;
  displayFile: string;
  direction: Direction;
  signature: Signature;
  imports: ImportDecl[];
  nodes: GraphNode[];
  edges: Edge[];
};

export type SpanRole = 'decision' | 'call' | 'return' | 'signature';

export type MappedSpan = {
  start: number;
  end: number;
  line: number;
  nodeId?: string;
  role: SpanRole;
};

import ts from 'typescript';
import { expressionOf, literalPhrase, structuralKey } from '../vocabulary.js';
import { questionFromName } from './questions.js';

type Operator = 'top' | 'or' | 'and' | 'not' | 'atom';

export type LabelRole = {
  decision: boolean;
  booleanCallees: ReadonlySet<string>;
};

export function formatLabel(label: string, vocabulary: ReadonlyMap<string, string>, role?: LabelRole): string {
  if (label === 'start') {
    return 'Start';
  }
  if (role?.decision) {
    const question = questionForCall(label, vocabulary, role.booleanCallees);
    if (question) {
      return question;
    }
  }
  const returned = /^return\s+([\s\S]+)$/.exec(label);
  if (returned) {
    return presentBoolean(formatExpression(returned[1]?.trim() ?? '', vocabulary));
  }
  const legacyCall = /^call\s+([\s\S]+)$/.exec(label);
  if (legacyCall) {
    return formatExpression(legacyCall[1]?.trim() ?? '', vocabulary);
  }
  return presentBoolean(formatExpression(label, vocabulary));
}

export function formatExpression(text: string, vocabulary: ReadonlyMap<string, string>): string {
  const expression = expressionOf(text);
  if (!expression) {
    return text.trim();
  }
  return formatNode(expression, vocabulary, 'top');
}

function formatNode(node: ts.Node, vocabulary: ReadonlyMap<string, string>, parent: Operator): string {
  if (ts.isParenthesizedExpression(node)) {
    const inner = formatNode(node.expression, vocabulary, 'top');
    if (parent !== 'top' && groupsLogic(node.expression)) {
      return `(${inner})`;
    }
    return inner;
  }
  const alternatives = orAlternatives(node);
  if (alternatives) {
    const text = `${formatNode(alternatives.subject, vocabulary, 'atom')} is ${joinAlternatives(alternatives.values.map((value) => formatCompared(value, vocabulary, alternatives.subject)))}`;
    return parent === 'top' ? text : `(${text})`;
  }
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken) {
    const inner = formatNode(node.operand, vocabulary, 'not');
    const text = groupsLogic(node.operand) ? `not (${stripOuter(inner)})` : `not ${inner}`;
    if (parent === 'atom' || parent === 'and' || parent === 'or') {
      return `(${text})`;
    }
    return text;
  }
  if (ts.isBinaryExpression(node)) {
    return formatBinary(node, vocabulary, parent);
  }
  if (ts.isCallExpression(node)) {
    return formatCall(node, vocabulary);
  }
  return formatAtom(node, vocabulary);
}

function formatBinary(node: ts.BinaryExpression, vocabulary: ReadonlyMap<string, string>, parent: Operator): string {
  const operator = node.operatorToken.kind;
  if (operator === ts.SyntaxKind.AmpersandAmpersandToken || operator === ts.SyntaxKind.BarBarToken) {
    const own: Operator = operator === ts.SyntaxKind.BarBarToken ? 'or' : 'and';
    const word = own === 'or' ? 'or' : 'and';
    const left = formatNode(node.left, vocabulary, own);
    const right = formatNode(node.right, vocabulary, own);
    const text = `${left} ${word} ${right}`;
    if (parent === 'not' || (parent === 'and' && own === 'or') || (parent === 'or' && own === 'and')) {
      return `(${text})`;
    }
    return text;
  }
  if (operator === ts.SyntaxKind.EqualsEqualsEqualsToken || operator === ts.SyntaxKind.ExclamationEqualsEqualsToken) {
    const word = operator === ts.SyntaxKind.EqualsEqualsEqualsToken ? 'is' : 'is not';
    const text = `${formatNode(node.left, vocabulary, 'atom')} ${word} ${formatCompared(node.right, vocabulary, node.left)}`;
    return parent === 'not' ? `(${text})` : text;
  }
  return node.getText().trim();
}

function questionForCall(
  label: string,
  vocabulary: ReadonlyMap<string, string>,
  booleanCallees: ReadonlySet<string>,
): string | undefined {
  const source = /^call\s+([\s\S]+)$/.exec(label)?.[1]?.trim() ?? label.trim();
  const expression = expressionOf(source);
  if (!expression) {
    return undefined;
  }
  let node: ts.Node = expression;
  while (ts.isParenthesizedExpression(node)) {
    node = node.expression;
  }
  if (!ts.isCallExpression(node) || node.questionDotToken || node.typeArguments || !ts.isIdentifier(node.expression)) {
    return undefined;
  }
  if (!booleanCallees.has(node.expression.text)) {
    return undefined;
  }
  return questionFromName(node.expression.text, vocabulary);
}

function formatCall(node: ts.CallExpression, vocabulary: ReadonlyMap<string, string>): string {
  if (node.questionDotToken || node.typeArguments || !ts.isIdentifier(node.expression)) {
    return node.getText().trim();
  }
  const args = node.arguments.map((argument) => {
    if (ts.isSpreadElement(argument)) {
      return argument.getText().trim();
    }
    return formatNode(argument, vocabulary, 'top');
  });
  return `${node.expression.text}(${args.join(', ')})`;
}

function formatCompared(node: ts.Node, vocabulary: ReadonlyMap<string, string>, subject: ts.Node): string {
  const phrase = literalPhrase(vocabulary, node, subject);
  if (phrase) {
    return phrase;
  }
  return formatNode(node, vocabulary, 'atom');
}

function formatAtom(node: ts.Node, vocabulary: ReadonlyMap<string, string>): string {
  const key = structuralKey(node);
  if (key) {
    const phrase = vocabulary.get(key);
    if (phrase) {
      return phrase;
    }
  }
  return node.getText().trim();
}

function orAlternatives(node: ts.Node): { subject: ts.Expression; values: ts.Expression[] } | undefined {
  const leaves = orLeaves(node);
  if (!leaves || leaves.length < 2) {
    return undefined;
  }
  let subject: ts.Expression | undefined;
  let subjectKey: string | undefined;
  const values: ts.Expression[] = [];
  for (const leaf of leaves) {
    if (!ts.isBinaryExpression(leaf) || leaf.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsEqualsToken) {
      return undefined;
    }
    if (!isSafeSubject(leaf.left) || !isSimpleValue(leaf.right)) {
      return undefined;
    }
    const key = structuralKey(leaf.left);
    if (!key) {
      return undefined;
    }
    if (!subject || !subjectKey) {
      subject = leaf.left;
      subjectKey = key;
    } else if (key !== subjectKey) {
      return undefined;
    }
    values.push(leaf.right);
  }
  if (!subject) {
    return undefined;
  }
  return { subject, values };
}

function orLeaves(node: ts.Node): ts.Expression[] | undefined {
  if (ts.isParenthesizedExpression(node)) {
    return undefined;
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
    const left = orLeaves(node.left);
    const right = orLeaves(node.right);
    if (!left || !right) {
      return undefined;
    }
    return [...left, ...right];
  }
  if (ts.isExpression(node)) {
    return [node];
  }
  return undefined;
}

function isSafeSubject(node: ts.Node): boolean {
  if (ts.isParenthesizedExpression(node)) {
    return isSafeSubject(node.expression);
  }
  if (ts.isIdentifier(node)) {
    return true;
  }
  if (ts.isPropertyAccessExpression(node)) {
    return !node.questionDotToken && ts.isIdentifier(node.name) && isSafeSubject(node.expression);
  }
  return false;
}

function isSimpleValue(node: ts.Node): boolean {
  if (ts.isParenthesizedExpression(node)) {
    return isSimpleValue(node.expression);
  }
  return structuralKey(node) !== undefined && !ts.isCallExpression(node);
}

function groupsLogic(node: ts.Node): boolean {
  if (ts.isParenthesizedExpression(node)) {
    return groupsLogic(node.expression);
  }
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken) {
    return groupsLogic(node.operand);
  }
  return ts.isBinaryExpression(node) && isLogic(node.operatorToken.kind);
}

function isLogic(kind: ts.SyntaxKind): boolean {
  return (
    kind === ts.SyntaxKind.AmpersandAmpersandToken ||
    kind === ts.SyntaxKind.BarBarToken ||
    kind === ts.SyntaxKind.EqualsEqualsEqualsToken ||
    kind === ts.SyntaxKind.ExclamationEqualsEqualsToken
  );
}

function stripOuter(text: string): string {
  if (text.startsWith('(') && text.endsWith(')')) {
    return text.slice(1, -1);
  }
  return text;
}

function joinAlternatives(values: string[]): string {
  if (values.length <= 1) {
    return values[0] ?? '';
  }
  if (values.length === 2) {
    return `${values[0]} or ${values[1]}`;
  }
  return `${values.slice(0, -1).join(', ')}, or ${values[values.length - 1]}`;
}

function presentBoolean(text: string): string {
  if (text === 'true') {
    return 'True';
  }
  if (text === 'false') {
    return 'False';
  }
  return text;
}

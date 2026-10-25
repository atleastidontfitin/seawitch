import ts from 'typescript';
import type { Expr, Location } from '../ir.js';

export type ParsedExpression = {
  text: string;
  refs: Expr[];
  callees: string[];
};

const COMPARISON = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.LessThanToken,
  ts.SyntaxKind.LessThanEqualsToken,
  ts.SyntaxKind.GreaterThanToken,
  ts.SyntaxKind.GreaterThanEqualsToken,
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.BarBarToken,
]);

export function parseExpression(
  text: string,
  loc: Location,
): { value: ParsedExpression } | { message: string } {
  const source = ts.createSourceFile(
    'expression.ts',
    `(${text}\n);`,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TS,
  );
  const syntaxErrors = (source as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics;
  if ((syntaxErrors?.length ?? 0) > 0 || source.statements.length !== 1) {
    return { message: 'The expression is not valid TypeScript.' };
  }
  const statement = source.statements[0];
  if (!statement || !ts.isExpressionStatement(statement)) {
    return { message: 'The expression is not valid TypeScript.' };
  }
  const refs: Expr[] = [];
  const callees: string[] = [];
  const message = walk(statement.expression, source, loc, refs, callees);
  if (message) {
    return { message };
  }
  return { value: { text, refs, callees } };
}

function walk(
  node: ts.Node,
  source: ts.SourceFile,
  loc: Location,
  refs: Expr[],
  callees: string[],
): string | undefined {
  if (ts.isParenthesizedExpression(node)) {
    return walk(node.expression, source, loc, refs, callees);
  }
  if (node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword || node.kind === ts.SyntaxKind.NullKeyword) {
    return undefined;
  }
  if (ts.isIdentifier(node)) {
    if (node.text === 'undefined' || node.text === 'this') {
      return `'${node.text}' is not allowed in an expression.`;
    }
    refs.push({ kind: 'ref', name: node.text, loc });
    return undefined;
  }
  if (ts.isStringLiteral(node)) {
    const raw = node.getText(source);
    if (!raw.startsWith("'")) {
      return 'Expression strings must be single-quoted.';
    }
    return undefined;
  }
  if (ts.isNumericLiteral(node)) {
    return decimal(node.getText(source));
  }
  if (ts.isPrefixUnaryExpression(node)) {
    if (node.operator === ts.SyntaxKind.ExclamationToken) {
      return walk(node.operand, source, loc, refs, callees);
    }
    if (node.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(node.operand)) {
      return decimal(node.operand.getText(source));
    }
    return 'This operator is not part of the expression subset.';
  }
  if (ts.isPropertyAccessExpression(node)) {
    if (node.questionDotToken) {
      return 'Optional chaining is not allowed.';
    }
    if (!ts.isIdentifier(node.name)) {
      return 'This property access is not allowed.';
    }
    return walk(node.expression, source, loc, refs, callees);
  }
  if (ts.isCallExpression(node)) {
    if (node.questionDotToken) {
      return 'Optional calls are not allowed.';
    }
    if (node.typeArguments) {
      return 'Generic calls are not allowed. Wrap this call in a monomorphic function.';
    }
    if (ts.isIdentifier(node.expression)) {
      if (node.expression.text === 'undefined' || node.expression.text === 'this') {
        return `'${node.expression.text}' is not allowed in an expression.`;
      }
      callees.push(node.expression.text);
    } else if (ts.isPropertyAccessExpression(node.expression)) {
      if (node.expression.questionDotToken) {
        return 'Optional chaining is not allowed.';
      }
      const target = walk(node.expression.expression, source, loc, refs, callees);
      if (target) {
        return target;
      }
    } else {
      return 'Call a function by name or as a method.';
    }
    for (const argument of node.arguments) {
      if (ts.isSpreadElement(argument)) {
        return 'Spread arguments are not allowed.';
      }
      const argumentMessage = walk(argument, source, loc, refs, callees);
      if (argumentMessage) {
        return argumentMessage;
      }
    }
    return undefined;
  }
  if (ts.isBinaryExpression(node)) {
    if (
      node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsToken ||
      node.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsToken
    ) {
      return 'Loose equality is not part of the expression subset. Use === or !==.';
    }
    if (!COMPARISON.has(node.operatorToken.kind)) {
      return 'This operator is not part of the expression subset.';
    }
    return walk(node.left, source, loc, refs, callees) ?? walk(node.right, source, loc, refs, callees);
  }
  if (ts.isConditionalExpression(node)) {
    return 'Conditional expressions are not allowed. Use a decision node.';
  }
  if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isSatisfiesExpression(node)) {
    return 'Type assertions are not allowed.';
  }
  if (ts.isNonNullExpression(node)) {
    return 'Non-null assertions are not allowed.';
  }
  if (ts.isObjectLiteralExpression(node) || ts.isArrayLiteralExpression(node)) {
    return 'Object and array literals are not allowed.';
  }
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
    return 'Functions are not allowed in an expression.';
  }
  if (
    ts.isNewExpression(node) ||
    ts.isAwaitExpression(node) ||
    ts.isYieldExpression(node) ||
    ts.isDeleteExpression(node) ||
    ts.isVoidExpression(node) ||
    ts.isTypeOfExpression(node) ||
    ts.isTemplateExpression(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    ts.isTaggedTemplateExpression(node) ||
    ts.isPostfixUnaryExpression(node)
  ) {
    return 'This expression is not allowed.';
  }
  return 'This expression is not allowed.';
}

function decimal(raw: string): string | undefined {
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(raw)) {
    return 'Only decimal numbers are allowed.';
  }
  return undefined;
}

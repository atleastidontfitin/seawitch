import path from 'node:path';
import ts from 'typescript';
import type { Diagnostic, DiagnosticCode } from '../diagnostics.js';
import type { MappedSpan } from '../ir.js';
import type { EmittedFile } from '../emit/typescript.js';

export function typecheck(files: EmittedFile[], outRoot: string): Diagnostic[] {
  const options: ts.CompilerOptions = {
    strict: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    noEmit: true,
    skipLibCheck: true,
  };
  const virtual = new Map<string, string>();
  for (const file of files) {
    virtual.set(normalize(file.outputPath), file.contents);
  }
  virtual.set(normalize(path.join(outRoot, 'package.json')), '{ "type": "module" }\n');

  const host = ts.createCompilerHost(options);
  const originalGetSourceFile = host.getSourceFile.bind(host);
  const originalFileExists = host.fileExists.bind(host);
  const originalReadFile = host.readFile.bind(host);
  const originalDirectoryExists = host.directoryExists?.bind(host) ?? (() => true);

  host.fileExists = (fileName) => virtual.has(normalize(fileName)) || originalFileExists(fileName);
  host.readFile = (fileName) => virtual.get(normalize(fileName)) ?? originalReadFile(fileName);
  host.directoryExists = (directory) => {
    const normalized = normalize(directory);
    for (const fileName of virtual.keys()) {
      if (fileName === normalized || fileName.startsWith(`${normalized}${path.sep}`)) {
        return true;
      }
    }
    return originalDirectoryExists(directory);
  };
  host.getSourceFile = (fileName, languageVersionOrOptions, onError, shouldCreateNewSourceFile) => {
    const text = virtual.get(normalize(fileName));
    if (text === undefined) {
      return originalGetSourceFile(fileName, languageVersionOrOptions, onError, shouldCreateNewSourceFile);
    }
    const target = typeof languageVersionOrOptions === 'object'
      ? languageVersionOrOptions.languageVersion
      : languageVersionOrOptions;
    return ts.createSourceFile(fileName, text, target ?? ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  };

  const program = ts.createProgram(files.map((file) => file.outputPath), options, host);
  const checker = program.getTypeChecker();
  const diagnostics: Diagnostic[] = [];

  for (const file of files) {
    const sourceFile = program.getSourceFile(file.outputPath);
    if (!sourceFile) {
      continue;
    }
    for (const span of file.spans) {
      if (span.role !== 'call' && span.role !== 'decision' && span.role !== 'return') {
        continue;
      }
      const expression = findExact(sourceFile, span.start, span.end);
      if (!expression) {
        continue;
      }
      for (const call of callsIn(expression)) {
        diagnoseCallee(call, checker, file, span, diagnostics);
      }
      if (span.role === 'decision') {
        diagnoseBoolean(expression, checker, file, span, diagnostics);
      }
    }
  }

  for (const diagnostic of ts.getPreEmitDiagnostics(program)) {
    if (diagnostic.category !== ts.DiagnosticCategory.Error || !diagnostic.file || diagnostic.start === undefined) {
      continue;
    }
    const file = files.find((candidate) => normalize(candidate.outputPath) === normalize(diagnostic.file?.fileName ?? ''));
    if (!file) {
      continue;
    }
    const end = diagnostic.start + (diagnostic.length ?? 0);
    const span = spanFor(diagnostic.start, end, file.spans);
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
    if (!span) {
      diagnostics.push({
        code: 'SW014',
        file: file.graph.displayFile,
        line: 1,
        message,
      });
      continue;
    }
    diagnostics.push({
      code: codeFor(span),
      file: file.graph.displayFile,
      line: span.line,
      nodeId: span.nodeId,
      message,
    });
  }

  return diagnostics;
}

function diagnoseCallee(
  call: ts.CallExpression,
  checker: ts.TypeChecker,
  file: EmittedFile,
  span: MappedSpan,
  diagnostics: Diagnostic[],
): void {
  const calleeType = checker.getTypeAtLocation(call.expression);
  const signatures = calleeType.getCallSignatures();
  if (signatures.length !== 1) {
    diagnostics.push(calleeDiagnostic(file, span, 'Wrap this callee in a single non-overloaded TypeScript function.'));
    return;
  }
  const signature = signatures[0];
  if (!signature) {
    return;
  }
  if ((signature.typeParameters?.length ?? 0) > 0) {
    diagnostics.push(calleeDiagnostic(file, span, 'Generic callees are not supported. Wrap this callee in a monomorphic function.'));
    return;
  }
  if (signature.parameters.some((parameter) => isRestParameter(parameter))) {
    diagnostics.push(calleeDiagnostic(file, span, 'Rest parameters are not supported. Wrap this callee in a fixed-arity function.'));
    return;
  }
  const returnType = checker.getReturnTypeOfSignature(signature);
  if (containsPromise(returnType)) {
    diagnostics.push(calleeDiagnostic(file, span, 'Asynchronous or Promise-returning callees are not supported.'));
  }
}

export function signatureReturnsPlainBoolean(checker: ts.TypeChecker, signature: ts.Signature): boolean {
  if ((signature.typeParameters?.length ?? 0) > 0) {
    return false;
  }
  if (signature.parameters.some((parameter) => isRestParameter(parameter))) {
    return false;
  }
  const returnType = checker.getReturnTypeOfSignature(signature);
  if (containsPromise(returnType)) {
    return false;
  }
  if (hasFlag(returnType, ts.TypeFlags.Any) || hasFlag(returnType, ts.TypeFlags.Unknown)) {
    return false;
  }
  if (hasFlag(returnType, ts.TypeFlags.Null) || hasFlag(returnType, ts.TypeFlags.Undefined)) {
    return false;
  }
  return checker.isTypeAssignableTo(returnType, checker.getBooleanType());
}

function diagnoseBoolean(
  expression: ts.Node,
  checker: ts.TypeChecker,
  file: EmittedFile,
  span: MappedSpan,
  diagnostics: Diagnostic[],
): void {
  const type = checker.getTypeAtLocation(expression);
  const subject = ts.isCallExpression(expression) ? 'Decision call must return' : 'Decision expression must be';
  if (hasFlag(type, ts.TypeFlags.Any) || hasFlag(type, ts.TypeFlags.Unknown)) {
    diagnostics.push({
      code: 'SW301',
      file: file.graph.displayFile,
      line: span.line,
      nodeId: span.nodeId,
      message: `${subject} a type assignable to boolean; actual return type is ${checker.typeToString(type)}.`,
    });
    return;
  }
  if (hasFlag(type, ts.TypeFlags.Null) || hasFlag(type, ts.TypeFlags.Undefined)) {
    diagnostics.push({
      code: 'SW301',
      file: file.graph.displayFile,
      line: span.line,
      nodeId: span.nodeId,
      message: `${subject} a non-nullable boolean; actual return type is ${checker.typeToString(type)}.`,
    });
    return;
  }
  if (!checker.isTypeAssignableTo(type, checker.getBooleanType())) {
    diagnostics.push({
      code: 'SW301',
      file: file.graph.displayFile,
      line: span.line,
      nodeId: span.nodeId,
      message: `${subject} a type assignable to boolean; actual return type is ${checker.typeToString(type)}.`,
    });
  }
}

function calleeDiagnostic(file: EmittedFile, span: MappedSpan, message: string): Diagnostic {
  return {
    code: 'SW304',
    file: file.graph.displayFile,
    line: span.line,
    nodeId: span.nodeId,
    message,
  };
}

function isRestParameter(parameter: ts.Symbol): boolean {
  const declaration = parameter.valueDeclaration ?? parameter.declarations?.[0];
  return declaration !== undefined && ts.isParameter(declaration) && declaration.dotDotDotToken !== undefined;
}

function containsPromise(type: ts.Type): boolean {
  if (type.isUnion()) {
    return type.types.some((part) => containsPromise(part));
  }
  const reference = type as ts.TypeReference;
  const symbol = reference.target?.getSymbol() ?? type.getSymbol();
  if (symbol?.getName() !== 'Promise') {
    return false;
  }
  return (symbol.declarations ?? []).some((declaration) =>
    declaration.getSourceFile().fileName.replaceAll('\\', '/').includes('/typescript/lib/'),
  );
}

function hasFlag(type: ts.Type, flag: ts.TypeFlags): boolean {
  if ((type.flags & flag) !== 0) {
    return true;
  }
  return type.isUnion() && type.types.some((part) => hasFlag(part, flag));
}

function findExact(sourceFile: ts.SourceFile, start: number, end: number): ts.Node | undefined {
  let found: ts.Node | undefined;
  const visit = (node: ts.Node): void => {
    if (found) {
      return;
    }
    if (node.getStart(sourceFile) === start && node.getEnd() === end) {
      found = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

function callsIn(node: ts.Node): ts.CallExpression[] {
  const calls: ts.CallExpression[] = [];
  const visit = (current: ts.Node): void => {
    if (ts.isCallExpression(current)) {
      calls.push(current);
    }
    ts.forEachChild(current, visit);
  };
  visit(node);
  return calls;
}

function spanFor(start: number, end: number, spans: MappedSpan[]): MappedSpan | undefined {
  const containing = spans.filter((span) => start >= span.start && start < span.end);
  containing.sort((left, right) => left.end - left.start - (right.end - right.start));
  if (containing[0]) {
    return containing[0];
  }
  return spans.find((span) => span.start >= start && span.end <= end);
}

function codeFor(span: MappedSpan): DiagnosticCode {
  if (span.role === 'return') {
    return 'SW302';
  }
  if (span.role === 'signature') {
    return 'SW014';
  }
  return 'SW303';
}

function normalize(fileName: string): string {
  return path.normalize(fileName);
}

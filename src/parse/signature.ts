import ts from 'typescript';
import type { Diagnostic } from '../diagnostics.js';
import type { ImportDecl, Signature } from '../ir.js';

type Parsed<T> = { value: T } | { diagnostic: Diagnostic };

function parseDiagnosticsOf(source: ts.SourceFile): readonly ts.Diagnostic[] {
  const parsed = source as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] };
  return parsed.parseDiagnostics ?? [];
}

function invalid(file: string, line: number, message: string, code: Diagnostic['code'] = 'SW014'): Diagnostic {
  return { code, file, line, message };
}

export function parseFunctionDirective(body: string, file: string, line: number): Parsed<Signature> {
  const trimmed = body.trim();
  const sourceText = `export ${trimmed.endsWith(';') ? trimmed : `${trimmed};`}`;
  const source = ts.createSourceFile('seawitch-function.ts', sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const parseError = parseDiagnosticsOf(source)[0];
  if (parseError) {
    return {
      diagnostic: invalid(
        file,
        line,
        `Invalid function signature: ${ts.flattenDiagnosticMessageText(parseError.messageText, '\n')}`,
      ),
    };
  }
  if (source.statements.length !== 1 || !ts.isFunctionDeclaration(source.statements[0])) {
    return { diagnostic: invalid(file, line, 'A function directive must be a single function declaration.') };
  }
  const declaration = source.statements[0];
  if (declaration.body) {
    return { diagnostic: invalid(file, line, 'A function directive must not include a body.') };
  }
  if (!declaration.name || !ts.isIdentifier(declaration.name)) {
    return { diagnostic: invalid(file, line, 'A function directive requires a name.') };
  }
  if (declaration.typeParameters?.length) {
    return { diagnostic: invalid(file, line, 'Generic Seawitch functions are not supported.') };
  }
  if (!declaration.type) {
    return { diagnostic: invalid(file, line, 'A function directive requires an explicit return type.') };
  }
  const params: Signature['params'] = [];
  for (const parameter of declaration.parameters) {
    if (!ts.isIdentifier(parameter.name) || parameter.questionToken || parameter.dotDotDotToken || parameter.initializer) {
      return {
        diagnostic: invalid(file, line, 'Parameters must be required identifiers with an explicit type.'),
      };
    }
    if (!parameter.type) {
      return { diagnostic: invalid(file, line, `Parameter '${parameter.name.text}' requires an explicit type.`) };
    }
    params.push({
      name: parameter.name.text,
      typeText: parameter.type.getText(source),
      loc: { line, column: 1 },
    });
  }
  return {
    value: {
      name: declaration.name.text,
      params,
      returnType: declaration.type.getText(source),
      loc: { line, column: 1 },
    },
  };
}

export function parseImportDirective(body: string, file: string, line: number): Parsed<ImportDecl> {
  const trimmed = body.trim();
  const sourceText = trimmed.endsWith(';') ? trimmed : `${trimmed};`;
  const source = ts.createSourceFile('seawitch-import.ts', sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const parseError = parseDiagnosticsOf(source)[0];
  if (parseError) {
    return {
      diagnostic: invalid(
        file,
        line,
        `Invalid import: ${ts.flattenDiagnosticMessageText(parseError.messageText, '\n')}`,
      ),
    };
  }
  if (source.statements.length !== 1 || !ts.isImportDeclaration(source.statements[0])) {
    return { diagnostic: invalid(file, line, 'An import directive must be a single import declaration.', 'SW404') };
  }
  const declaration = source.statements[0];
  if (declaration.attributes) {
    return { diagnostic: invalid(file, line, 'Import attributes are not supported.', 'SW404') };
  }
  const clause = declaration.importClause;
  if (!clause || clause.name || !clause.namedBindings || !ts.isNamedImports(clause.namedBindings)) {
    return {
      diagnostic: invalid(
        file,
        line,
        'Imports must be named: import { A } from "./module.js" or import type { A } from "./module.js".',
        'SW404',
      ),
    };
  }
  const names: string[] = [];
  for (const element of clause.namedBindings.elements) {
    if (element.propertyName || element.isTypeOnly) {
      return { diagnostic: invalid(file, line, 'Import aliases and inline type modifiers are not supported.', 'SW404') };
    }
    names.push(element.name.text);
  }
  if (names.length === 0) {
    return { diagnostic: invalid(file, line, 'An import must name at least one symbol.', 'SW404') };
  }
  if (!ts.isStringLiteral(declaration.moduleSpecifier)) {
    return { diagnostic: invalid(file, line, 'Import specifiers must be string literals.', 'SW404') };
  }
  const specifier = declaration.moduleSpecifier.text;
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
    return { diagnostic: invalid(file, line, `Import '${specifier}' must be a relative path.`, 'SW404') };
  }
  if (!specifier.endsWith('.js') && !specifier.endsWith('.sea.mmd')) {
    return {
      diagnostic: invalid(file, line, `Import '${specifier}' must end in .js or .sea.mmd.`, 'SW404'),
    };
  }
  const kind = clause.isTypeOnly ? 'type' : 'value';
  if (kind === 'type' && specifier.endsWith('.sea.mmd')) {
    return {
      diagnostic: invalid(file, line, 'Seawitch modules export only their function, not types.', 'SW402'),
    };
  }
  return {
    value: {
      kind,
      names,
      specifier,
      loc: { line, column: 1 },
    },
  };
}

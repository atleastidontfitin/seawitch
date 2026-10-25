export const DIAGNOSTIC_CODES = [
  'SW010',
  'SW011',
  'SW012',
  'SW013',
  'SW014',
  'SW015',
  'SW016',
  'SW018',
  'SW101',
  'SW102',
  'SW103',
  'SW104',
  'SW105',
  'SW106',
  'SW107',
  'SW108',
  'SW109',
  'SW203',
  'SW301',
  'SW302',
  'SW303',
  'SW304',
  'SW401',
  'SW402',
  'SW403',
  'SW404',
] as const;

export type DiagnosticCode = (typeof DIAGNOSTIC_CODES)[number];

export type Diagnostic = {
  code: DiagnosticCode;
  file: string;
  line: number;
  nodeId?: string;
  message: string;
};

export function formatDiagnostic(diagnostic: Diagnostic): string {
  const location = diagnostic.nodeId
    ? `${diagnostic.file}:${diagnostic.line} [${diagnostic.nodeId}]`
    : `${diagnostic.file}:${diagnostic.line}`;
  return `${diagnostic.code} ${location}: ${diagnostic.message}`;
}

export function formatDiagnostics(diagnostics: Diagnostic[]): string {
  return diagnostics.map(formatDiagnostic).join('\n');
}

export interface ParserDiagnosticLocation {
  readonly line: number;
  readonly column: number;
}

export interface ParserError {
  readonly code: string;
  readonly message: string;
  readonly location?: ParserDiagnosticLocation;
}

export interface ParserWarning {
  readonly code: string;
  readonly message: string;
  readonly location?: ParserDiagnosticLocation;
}

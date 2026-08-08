/** Structured errors returned by the CFP definition parser. */

export type CfpParseErrorCode =
  | "malformed_definition"
  | "unsupported_version"
  | "duplicate_id"
  | "unknown_question_type"
  | "missing_rule_target"
  | "cyclic_rule"
  | "impossible_rule";

export interface CfpParseError {
  code: CfpParseErrorCode;
  /** Dot-separated path to the offending value, e.g. "sections.0.questions.1.visibleWhen". */
  path: string;
  message: string;
}

export function cfpError(code: CfpParseErrorCode, path: string, message: string): CfpParseError {
  return { code, path, message };
}

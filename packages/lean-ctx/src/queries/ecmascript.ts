const SHARED_PATTERNS = `
(import_statement source: (string) @source) @import
(export_statement source: (string) @source) @reexport
(call_expression
  function: (import)
  arguments: (arguments . (string) @source)) @dynamic
(call_expression
  function: (identifier) @callee
  arguments: (arguments . (string) @source)
  (#eq? @callee "require")) @require
`;

export const JAVASCRIPT_IMPORTS_QUERY = SHARED_PATTERNS;

export const TYPESCRIPT_IMPORTS_QUERY = `${SHARED_PATTERNS}
(import_require_clause source: (string) @source) @require
`;

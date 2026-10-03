import type Parser from "tree-sitter";
import type { LanguageId } from "../languages";
import type { ImportKind, ImportRef } from "../model";
import type { SyntaxNode } from "./context";

const CAPTURE_KINDS: Readonly<Record<string, ImportKind>> = {
  import: "static",
  require: "require",
  reexport: "reexport",
  dynamic: "dynamic",
};

function hasKeyword(node: SyntaxNode, keyword: string): boolean {
  return node.children.some((child) => !child.isNamed && child.type === keyword);
}

function stringValue(node: SyntaxNode): string {
  return node.namedChildren
    .filter((child) => child.type === "string_fragment" || child.type === "escape_sequence")
    .map((child) => child.text)
    .join("");
}

function importedNames(statement: SyntaxNode): { names: string[]; allTypes: boolean } {
  const clause = statement.namedChildren.find((child) => child.type === "import_clause");
  if (!clause) return { names: [], allTypes: false };
  const names: string[] = [];
  let valueBindings = 0;
  for (const part of clause.namedChildren) {
    if (part.type === "identifier") {
      names.push("default");
      valueBindings += 1;
    } else if (part.type === "namespace_import") {
      names.push("*");
      valueBindings += 1;
    } else if (part.type === "named_imports") {
      for (const specifier of part.namedChildren) {
        if (specifier.type !== "import_specifier") continue;
        const name = specifier.childForFieldName("name")?.text;
        if (name) names.push(name);
        if (!hasKeyword(specifier, "type")) valueBindings += 1;
      }
    }
  }
  return { names, allTypes: names.length > 0 && valueBindings === 0 };
}

function reexportedNames(statement: SyntaxNode): string[] {
  const clause = statement.namedChildren.find((child) => child.type === "export_clause");
  if (!clause) {
    const namespace = statement.namedChildren.find((child) => child.type === "namespace_export");
    return namespace ? [namespace.namedChildren[0]?.text ?? "*"] : ["*"];
  }
  return clause.namedChildren
    .filter((specifier) => specifier.type === "export_specifier")
    .map(
      (specifier) =>
        specifier.childForFieldName("alias")?.text ??
        specifier.childForFieldName("name")?.text ??
        "",
    )
    .filter((name) => name.length > 0);
}

function ecmaScriptImports(root: SyntaxNode, query: Parser.Query): ImportRef[] {
  const refs: ImportRef[] = [];
  for (const match of query.matches(root)) {
    const source = match.captures.find((capture) => capture.name === "source")?.node;
    const statement = match.captures.find((capture) => capture.name in CAPTURE_KINDS);
    if (!source || !statement) continue;
    const specifier = stringValue(source);
    if (specifier.length === 0) continue;
    const kind = CAPTURE_KINDS[statement.name] ?? "static";
    let names: string[] = [];
    let typeOnly = false;
    if (statement.node.type === "import_statement") {
      const imported = importedNames(statement.node);
      names = imported.names;
      typeOnly = hasKeyword(statement.node, "type") || imported.allTypes;
    } else if (statement.node.type === "export_statement") {
      names = reexportedNames(statement.node);
      typeOnly = hasKeyword(statement.node, "type");
    }
    refs.push({ specifier, kind, typeOnly, names, line: statement.node.startPosition.row + 1 });
  }
  return refs;
}

function isUnderTypeChecking(node: SyntaxNode): boolean {
  for (let current = node.parent; current; current = current.parent) {
    if (
      current.type === "if_statement" &&
      /TYPE_CHECKING/.test(current.childForFieldName("condition")?.text ?? "")
    ) {
      return true;
    }
  }
  return false;
}

function pythonName(node: SyntaxNode): string {
  return node.type === "aliased_import" ? (node.childForFieldName("name")?.text ?? "") : node.text;
}

function pythonImports(root: SyntaxNode, query: Parser.Query): ImportRef[] {
  const refs: ImportRef[] = [];
  for (const capture of query.captures(root)) {
    const statement = capture.node;
    const typeOnly = isUnderTypeChecking(statement);
    const line = statement.startPosition.row + 1;
    if (capture.name === "import") {
      for (const name of statement.childrenForFieldName("name")) {
        const specifier = pythonName(name);
        if (specifier) refs.push({ specifier, kind: "static", typeOnly, names: [], line });
      }
      continue;
    }
    const specifier = statement.childForFieldName("module_name")?.text;
    if (!specifier) continue;
    const wildcard = statement.namedChildren.some((child) => child.type === "wildcard_import");
    const names = wildcard
      ? ["*"]
      : statement
          .childrenForFieldName("name")
          .map(pythonName)
          .filter((name) => name.length > 0);
    refs.push({ specifier, kind: "static", typeOnly, names, line });
  }
  return refs;
}

export function extractImports(
  language: LanguageId,
  root: SyntaxNode,
  query: Parser.Query,
): ImportRef[] {
  return language === "python" ? pythonImports(root, query) : ecmaScriptImports(root, query);
}

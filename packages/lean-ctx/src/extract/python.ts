import { ELIDED_VALUE, inlinePlaceholder } from "../handles";
import type { LevelReplacements } from "../skeleton-plan";
import { isSingleLine, pythonDocSummary } from "../text";
import type { ExtractionContext, SyntaxNode } from "./context";

const VALUE_LIMITS = { signatures: 80, contracts: 600 };

interface Scope {
  prefix: string | null;
  topLevel: boolean;
  inClass: boolean;
  classExported: boolean;
}

function isPublicMember(name: string): boolean {
  return !name.startsWith("_") || (name.startsWith("__") && name.endsWith("__"));
}

function collectDunderAll(root: SyntaxNode): Set<string> | null {
  for (const statement of root.namedChildren) {
    const assignment = statement.namedChildren[0];
    if (statement.type !== "expression_statement" || assignment?.type !== "assignment") continue;
    if (assignment.childForFieldName("left")?.text !== "__all__") continue;
    const value = assignment.childForFieldName("right");
    if (!value || (value.type !== "list" && value.type !== "tuple")) return null;
    const names = new Set<string>();
    for (const item of value.namedChildren) {
      if (item.type !== "string") continue;
      const content = item.namedChildren.find((part) => part.type === "string_content");
      if (content) names.add(content.text);
    }
    return names;
  }
  return null;
}

function colonBefore(node: SyntaxNode, body: SyntaxNode): SyntaxNode | null {
  let colon: SyntaxNode | null = null;
  for (const child of node.children) {
    if (child.startIndex >= body.startIndex) break;
    if (child.type === ":") colon = child;
  }
  return colon;
}

function docstringOf(block: SyntaxNode): SyntaxNode | null {
  const first = block.namedChildren.find((child) => child.type !== "comment");
  if (first?.type !== "expression_statement") return null;
  const literal = first.namedChildren[0];
  return literal?.type === "string" ? literal : null;
}

class PythonWalker {
  constructor(
    private readonly ctx: ExtractionContext,
    private readonly publicNames: Set<string> | null,
  ) {}

  block(statements: readonly SyntaxNode[], scope: Scope): void {
    let first = true;
    for (const node of statements) {
      if (node.type === "comment") continue;
      const retained = this.statement(node, scope, first);
      first = false;
      if (scope.topLevel && retained) this.ctx.plan.keep(node);
      if (!scope.topLevel && !retained) this.ctx.plan.drop(node);
    }
  }

  dropComments(root: SyntaxNode): void {
    for (const comment of root.descendantsOfType("comment")) this.ctx.plan.drop(comment);
  }

  private statement(node: SyntaxNode, scope: Scope, first: boolean): boolean {
    switch (node.type) {
      case "import_statement":
      case "import_from_statement":
      case "future_import_statement":
      case "pass_statement":
        return true;
      case "function_definition":
        this.functionDefinition(node, node, scope);
        return true;
      case "class_definition":
        this.classDefinition(node, node, scope);
        return true;
      case "decorated_definition":
        return this.decoratedDefinition(node, scope);
      case "expression_statement":
        return this.expressionStatement(node, scope, first);
      case "type_alias_statement":
        this.typeAlias(node, scope);
        return true;
      case "if_statement":
        return (
          scope.topLevel && /TYPE_CHECKING/.test(node.childForFieldName("condition")?.text ?? "")
        );
      default:
        return false;
    }
  }

  private qualify(scope: Scope, name: string): string {
    return scope.prefix === null ? name : `${scope.prefix}.${name}`;
  }

  private isExported(name: string, scope: Scope): boolean {
    if (scope.inClass) return scope.classExported && isPublicMember(name);
    if (!scope.topLevel) return false;
    return this.publicNames === null ? !name.startsWith("_") : this.publicNames.has(name);
  }

  private decoratedDefinition(node: SyntaxNode, scope: Scope): boolean {
    const definition = node.childForFieldName("definition");
    if (definition?.type === "function_definition") {
      this.functionDefinition(definition, node, scope);
      return true;
    }
    if (definition?.type === "class_definition") {
      this.classDefinition(definition, node, scope);
      return true;
    }
    return false;
  }

  private functionDefinition(node: SyntaxNode, extent: SyntaxNode, scope: Scope): void {
    const name = node.childForFieldName("name")?.text ?? "anonymous";
    const body = node.childForFieldName("body");
    const colon = body ? colonBefore(node, body) : null;
    const handle = this.ctx.register({
      name,
      qualifiedName: this.qualify(scope, name),
      kind: scope.inClass ? "method" : "function",
      signature: this.ctx.signature(node.startIndex, colon?.startIndex ?? node.endIndex),
      extent,
      body: body?.text ?? null,
      exported: this.isExported(name, scope),
    });
    if (!body || !colon) return;
    const placeholder = inlinePlaceholder(handle);
    const indent = " ".repeat(body.startPosition.column);
    const docstring = docstringOf(body);
    const summary = docstring ? pythonDocSummary(docstring.text) : null;
    this.ctx.plan.replace(colon.endIndex, body.endIndex, {
      1: ` ${placeholder}`,
      2:
        summary === null || body.startPosition.row === colon.startPosition.row
          ? ` ${placeholder}`
          : `\n${indent}"""${summary}"""\n${indent}${placeholder}`,
    });
  }

  private classDefinition(node: SyntaxNode, extent: SyntaxNode, scope: Scope): void {
    const name = node.childForFieldName("name")?.text ?? "anonymous";
    const body = node.childForFieldName("body");
    const colon = body ? colonBefore(node, body) : null;
    const qualifiedName = this.qualify(scope, name);
    const exported = this.isExported(name, scope);
    this.ctx.register({
      name,
      qualifiedName,
      kind: "class",
      signature: this.ctx.signature(node.startIndex, colon?.startIndex ?? node.endIndex),
      extent,
      body: body?.text ?? null,
      exported,
    });
    if (body) {
      this.block(body.namedChildren, {
        prefix: qualifiedName,
        topLevel: false,
        inClass: true,
        classExported: exported,
      });
    }
  }

  private typeAlias(node: SyntaxNode, scope: Scope): void {
    const nameNode = node.namedChildren[0];
    const value = node.namedChildren[1];
    const name = nameNode?.text ?? "anonymous";
    const handle = this.ctx.register({
      name,
      qualifiedName: this.qualify(scope, name),
      kind: "type",
      signature: this.ctx.signature(node.startIndex, value?.startIndex ?? node.endIndex),
      extent: node,
      body: value?.text ?? null,
      exported: this.isExported(name, scope),
    });
    if (value) this.elideValue(value, handle);
  }

  private expressionStatement(node: SyntaxNode, scope: Scope, first: boolean): boolean {
    const expression = node.namedChildren[0];
    if (!expression) return false;
    if (expression.type === "ellipsis") return true;
    if (expression.type === "string") {
      if (!first || !(scope.topLevel || scope.inClass)) return false;
      const summary = pythonDocSummary(expression.text);
      this.ctx.plan.replaceSpan(node, { 1: "", 2: summary === null ? "" : `"""${summary}"""` });
      return true;
    }
    if (expression.type !== "assignment") return false;
    const target = expression.childForFieldName("left");
    const value = expression.childForFieldName("right");
    if (target?.type !== "identifier") return scope.inClass;
    if (scope.inClass) {
      if (value) this.elideValue(value, null);
      return true;
    }
    const name = target.text;
    const handle = this.ctx.register({
      name,
      qualifiedName: this.qualify(scope, name),
      kind: "variable",
      signature: this.ctx.signature(node.startIndex, value?.startIndex ?? node.endIndex),
      extent: node,
      body: value?.text ?? null,
      exported: this.isExported(name, scope),
    });
    if (value) this.elideValue(value, handle);
    return true;
  }

  private elideValue(value: SyntaxNode, handle: string | null): void {
    const text = value.text;
    const placeholder = handle === null ? ELIDED_VALUE : inlinePlaceholder(handle);
    const replacements: LevelReplacements = {};
    if (!isSingleLine(text) || text.length > VALUE_LIMITS.signatures) {
      replacements[1] = ` ${placeholder}`;
    }
    if (text.length > VALUE_LIMITS.contracts) replacements[2] = ` ${placeholder}`;
    if (replacements[1] !== undefined || replacements[2] !== undefined) {
      this.ctx.plan.replace(this.ctx.valueStart(value), value.endIndex, replacements);
    }
  }
}

export function extractPython(root: SyntaxNode, ctx: ExtractionContext): void {
  const walker = new PythonWalker(ctx, collectDunderAll(root));
  walker.block(root.namedChildren, {
    prefix: null,
    topLevel: true,
    inClass: false,
    classExported: true,
  });
  walker.dropComments(root);
}

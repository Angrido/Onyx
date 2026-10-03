import { blockPlaceholder, ELIDED_VALUE, inlinePlaceholder } from "../handles";
import type { SymbolKind } from "../model";
import { DROP, type LevelReplacements } from "../skeleton-plan";
import { isDocComment, isSingleLine, jsDocSummary } from "../text";
import type { ExtractionContext, SyntaxNode } from "./context";

const FUNCTION_VALUES = new Set([
  "arrow_function",
  "function_expression",
  "function",
  "generator_function",
]);

const CLASS_NODES = new Set(["class_declaration", "abstract_class_declaration", "class"]);

const DECLARATIONS = new Set([
  "function_declaration",
  "generator_function_declaration",
  "function_signature",
  "class_declaration",
  "abstract_class_declaration",
  "interface_declaration",
  "type_alias_declaration",
  "enum_declaration",
  "lexical_declaration",
  "variable_declaration",
  "ambient_declaration",
  "module",
  "internal_module",
]);

interface InlineLimits {
  signatures: number;
  contracts: number;
}

const VALUE_LIMITS: InlineLimits = { signatures: 80, contracts: 600 };
const TYPE_LIMITS: InlineLimits = { signatures: 80, contracts: 2_000 };
const COMPACT_BODY_LIMIT = 80;

interface Scope {
  prefix: string | null;
  topLevel: boolean;
  exportable: boolean;
}

interface LocalExports {
  locals: Set<string>;
  names: string[];
}

function docReplacements(comment: SyntaxNode): LevelReplacements {
  const summary = jsDocSummary(comment.text);
  return { 1: "", 2: summary === null ? "" : `/** ${summary} */` };
}

function unquote(text: string): string {
  return text.replace(/^['"`]|['"`]$/g, "");
}

function isCompact(text: string): boolean {
  return isSingleLine(text) && text.length <= COMPACT_BODY_LIMIT;
}

function isPrivateMember(member: SyntaxNode): boolean {
  if (member.childForFieldName("name")?.type === "private_property_identifier") return true;
  return member.namedChildren.some(
    (child) => child.type === "accessibility_modifier" && child.text === "private",
  );
}

function memberName(member: SyntaxNode): string | null {
  return (member.childForFieldName("name") ?? member.childForFieldName("property"))?.text ?? null;
}

function extendOverPrefix(node: SyntaxNode): SyntaxNode {
  let start = node;
  let previous = node.previousNamedSibling;
  while (previous && previous.type === "decorator") {
    start = previous;
    previous = previous.previousNamedSibling;
  }
  if (
    previous &&
    previous.type === "comment" &&
    isDocComment(previous.text) &&
    previous.endPosition.row >= start.startPosition.row - 1
  ) {
    start = previous;
  }
  return start;
}

function collectLocalExports(root: SyntaxNode): LocalExports {
  const locals = new Set<string>();
  const names: string[] = [];
  for (const statement of root.namedChildren) {
    if (statement.type !== "export_statement" || statement.childForFieldName("source")) continue;
    const value = statement.childForFieldName("value");
    if (value?.type === "identifier") {
      locals.add(value.text);
      names.push("default");
      continue;
    }
    const clause = statement.namedChildren.find((child) => child.type === "export_clause");
    for (const specifier of clause?.namedChildren ?? []) {
      if (specifier.type !== "export_specifier") continue;
      const local = specifier.childForFieldName("name")?.text;
      if (!local) continue;
      locals.add(local);
      names.push(specifier.childForFieldName("alias")?.text ?? local);
    }
  }
  return { locals, names };
}

class EcmaScriptWalker {
  constructor(
    private readonly ctx: ExtractionContext,
    private readonly localExports: LocalExports,
  ) {}

  statements(nodes: readonly SyntaxNode[], scope: Scope): void {
    let pendingDoc: SyntaxNode | null = null;
    let inPrologue = scope.topLevel;
    for (const node of nodes) {
      if (node.type === "hash_bang_line") continue;
      if (node.type === "comment") {
        if (pendingDoc) this.settleDoc(pendingDoc, false, scope);
        pendingDoc = isDocComment(node.text) ? node : null;
        continue;
      }
      const retained = this.statement(node, scope, inPrologue);
      inPrologue = inPrologue && this.isDirective(node);
      if (pendingDoc) {
        this.settleDoc(pendingDoc, retained, scope);
        pendingDoc = null;
      }
      if (scope.topLevel && retained) this.ctx.plan.keep(node);
      if (!scope.topLevel && !retained) this.ctx.plan.drop(node);
    }
    if (pendingDoc) this.settleDoc(pendingDoc, false, scope);
  }

  dropComments(root: SyntaxNode): void {
    for (const comment of root.descendantsOfType("comment")) {
      if (this.ctx.isCommentHandled(comment)) continue;
      const next = comment.nextNamedSibling;
      const documentsCode = isDocComment(comment.text) && next !== null && next.type !== "comment";
      this.ctx.plan.replaceSpan(comment, documentsCode ? docReplacements(comment) : DROP);
    }
  }

  private settleDoc(comment: SyntaxNode, retained: boolean, scope: Scope): void {
    if (!retained) {
      this.ctx.markComment(comment, DROP);
      return;
    }
    if (scope.topLevel) this.ctx.plan.keep(comment);
    this.ctx.markComment(comment, docReplacements(comment));
  }

  private isDirective(node: SyntaxNode): boolean {
    return node.type === "expression_statement" && node.namedChildren[0]?.type === "string";
  }

  private statement(node: SyntaxNode, scope: Scope, inPrologue: boolean): boolean {
    switch (node.type) {
      case "import_statement":
      case "import_alias":
        return true;
      case "export_statement":
        this.exportStatement(node, scope);
        return true;
      case "expression_statement":
        if (inPrologue && this.isDirective(node)) return true;
        return this.expressionStatement(node, scope);
      default:
        if (!DECLARATIONS.has(node.type)) return false;
        this.declaration(node, scope, false, node);
        return true;
    }
  }

  private qualify(scope: Scope, name: string): string {
    return scope.prefix === null ? name : `${scope.prefix}.${name}`;
  }

  private isExported(name: string, scope: Scope, explicit: boolean): boolean {
    return explicit || (scope.topLevel && this.localExports.locals.has(name));
  }

  private exportStatement(node: SyntaxNode, scope: Scope): void {
    const declaration = node.childForFieldName("declaration");
    if (declaration) {
      this.declaration(declaration, scope, scope.exportable, node);
      return;
    }
    const value = node.childForFieldName("value");
    if (!value || value.type === "identifier") return;
    if (CLASS_NODES.has(value.type)) {
      this.classDeclaration(value, scope, true, node);
      return;
    }
    if (FUNCTION_VALUES.has(value.type)) {
      this.functionValue("default", value, scope, true, node, `export default`);
      return;
    }
    const handle = this.ctx.register({
      name: "default",
      qualifiedName: this.qualify(scope, "default"),
      kind: "variable",
      signature: "export default",
      extent: node,
      extentStart: extendOverPrefix(node),
      body: value.text,
      exported: true,
    });
    this.elideValue(value, handle, VALUE_LIMITS);
  }

  private declaration(node: SyntaxNode, scope: Scope, exported: boolean, outer: SyntaxNode): void {
    switch (node.type) {
      case "function_declaration":
      case "generator_function_declaration":
      case "function_signature":
        this.functionDeclaration(node, scope, exported, outer);
        return;
      case "class_declaration":
      case "abstract_class_declaration":
        this.classDeclaration(node, scope, exported, outer);
        return;
      case "interface_declaration":
        this.bodyDeclaration(node, "interface", scope, exported, outer);
        return;
      case "enum_declaration":
        this.bodyDeclaration(node, "enum", scope, exported, outer);
        return;
      case "type_alias_declaration":
        this.typeAlias(node, scope, exported, outer);
        return;
      case "lexical_declaration":
      case "variable_declaration":
        this.variables(node, scope, exported, outer);
        return;
      case "ambient_declaration":
        this.ambient(node, scope, exported, outer);
        return;
      case "module":
      case "internal_module":
        this.namespace(node, scope, exported, outer);
        return;
    }
  }

  private functionDeclaration(
    node: SyntaxNode,
    scope: Scope,
    exported: boolean,
    outer: SyntaxNode,
  ): void {
    const name = node.childForFieldName("name")?.text ?? "default";
    const body = node.childForFieldName("body");
    const handle = this.ctx.register({
      name,
      qualifiedName: this.qualify(scope, name),
      kind: "function",
      signature: this.ctx.signature(node.startIndex, body?.startIndex ?? node.endIndex),
      extent: outer,
      extentStart: extendOverPrefix(outer),
      body: body?.text ?? null,
      exported: this.isExported(name, scope, exported),
    });
    if (body) this.elideBlock(body, handle);
  }

  private functionValue(
    name: string,
    value: SyntaxNode,
    scope: Scope,
    exported: boolean,
    outer: SyntaxNode,
    signaturePrefix: string,
  ): void {
    const body = value.childForFieldName("body");
    const handle = this.ctx.register({
      name,
      qualifiedName: this.qualify(scope, name),
      kind: "function",
      signature: `${signaturePrefix} ${this.ctx.signature(value.startIndex, body?.startIndex ?? value.endIndex)}`,
      extent: outer,
      extentStart: extendOverPrefix(outer),
      body: body?.text ?? null,
      exported: this.isExported(name, scope, exported),
    });
    this.elideFunction(value, handle);
  }

  private classDeclaration(
    node: SyntaxNode,
    scope: Scope,
    exported: boolean,
    outer: SyntaxNode,
  ): void {
    const name = node.childForFieldName("name")?.text ?? "default";
    const body = node.childForFieldName("body");
    const qualifiedName = this.qualify(scope, name);
    const isExported = this.isExported(name, scope, exported);
    this.ctx.register({
      name,
      qualifiedName,
      kind: "class",
      signature: this.ctx.signature(node.startIndex, body?.startIndex ?? node.endIndex),
      extent: outer,
      extentStart: extendOverPrefix(outer),
      body: body?.text ?? null,
      exported: isExported,
    });
    if (body) this.classMembers(body, qualifiedName, isExported);
  }

  private classMembers(body: SyntaxNode, prefix: string, classExported: boolean): void {
    for (const member of body.namedChildren) {
      switch (member.type) {
        case "method_definition": {
          const name = memberName(member) ?? "anonymous";
          const methodBody = member.childForFieldName("body");
          const handle = this.ctx.register({
            name,
            qualifiedName: `${prefix}.${name}`,
            kind: "method",
            signature: this.ctx.signature(
              member.startIndex,
              methodBody?.startIndex ?? member.endIndex,
            ),
            extent: member,
            extentStart: extendOverPrefix(member),
            body: methodBody?.text ?? null,
            exported: classExported && !isPrivateMember(member),
          });
          if (methodBody) this.elideBlock(methodBody, handle);
          break;
        }
        case "public_field_definition":
        case "field_definition": {
          const value = member.childForFieldName("value");
          if (!value) break;
          if (!FUNCTION_VALUES.has(value.type)) {
            this.elideValue(value, null, VALUE_LIMITS);
            break;
          }
          const name = memberName(member) ?? "anonymous";
          const fieldBody = value.childForFieldName("body");
          const handle = this.ctx.register({
            name,
            qualifiedName: `${prefix}.${name}`,
            kind: "method",
            signature: this.ctx.signature(
              member.startIndex,
              fieldBody?.startIndex ?? member.endIndex,
            ),
            extent: member,
            extentStart: extendOverPrefix(member),
            body: fieldBody?.text ?? null,
            exported: classExported && !isPrivateMember(member),
          });
          this.elideFunction(value, handle);
          break;
        }
        case "class_static_block":
          this.ctx.plan.drop(member);
          break;
        default:
          break;
      }
    }
  }

  private bodyDeclaration(
    node: SyntaxNode,
    kind: SymbolKind,
    scope: Scope,
    exported: boolean,
    outer: SyntaxNode,
  ): void {
    const name = node.childForFieldName("name")?.text ?? "anonymous";
    const body = node.childForFieldName("body");
    const handle = this.ctx.register({
      name,
      qualifiedName: this.qualify(scope, name),
      kind,
      signature: this.ctx.signature(node.startIndex, body?.startIndex ?? node.endIndex),
      extent: outer,
      extentStart: extendOverPrefix(outer),
      body: body?.text ?? null,
      exported: this.isExported(name, scope, exported),
    });
    if (body && !isCompact(body.text)) {
      this.ctx.plan.replaceSpan(body, { 1: blockPlaceholder(handle) });
    }
  }

  private typeAlias(node: SyntaxNode, scope: Scope, exported: boolean, outer: SyntaxNode): void {
    const name = node.childForFieldName("name")?.text ?? "anonymous";
    const value = node.childForFieldName("value");
    const handle = this.ctx.register({
      name,
      qualifiedName: this.qualify(scope, name),
      kind: "type",
      signature: this.ctx.signature(node.startIndex, value?.startIndex ?? node.endIndex),
      extent: outer,
      extentStart: extendOverPrefix(outer),
      body: value?.text ?? null,
      exported: this.isExported(name, scope, exported),
    });
    if (value) this.elideValue(value, handle, TYPE_LIMITS);
  }

  private variables(node: SyntaxNode, scope: Scope, exported: boolean, outer: SyntaxNode): void {
    const keyword = node.child(0)?.text ?? "const";
    const declarators = node.namedChildren.filter((child) => child.type === "variable_declarator");
    for (const declarator of declarators) {
      const nameNode = declarator.childForFieldName("name");
      const value = declarator.childForFieldName("value");
      if (!nameNode || nameNode.type !== "identifier") {
        if (value) this.elideValue(value, null, VALUE_LIMITS);
        continue;
      }
      const name = nameNode.text;
      const extent = declarators.length === 1 ? outer : declarator;
      if (value && FUNCTION_VALUES.has(value.type)) {
        this.functionValue(name, value, scope, exported, extent, `${keyword} ${name} =`);
        continue;
      }
      const handle = this.ctx.register({
        name,
        qualifiedName: this.qualify(scope, name),
        kind: "variable",
        signature: `${keyword} ${this.ctx.signature(declarator.startIndex, value?.startIndex ?? declarator.endIndex)}`,
        extent,
        extentStart: extendOverPrefix(extent),
        body: value?.text ?? null,
        exported: this.isExported(name, scope, exported),
      });
      if (value) this.elideValue(value, handle, VALUE_LIMITS);
    }
  }

  private ambient(node: SyntaxNode, scope: Scope, exported: boolean, outer: SyntaxNode): void {
    for (const child of node.namedChildren) {
      if (child.type === "statement_block") {
        this.statements(child.namedChildren, {
          prefix: this.qualify(scope, "global"),
          topLevel: false,
          exportable: true,
        });
        continue;
      }
      this.declaration(child, scope, exported, outer);
    }
  }

  private namespace(node: SyntaxNode, scope: Scope, exported: boolean, outer: SyntaxNode): void {
    const name = unquote(node.childForFieldName("name")?.text ?? "anonymous");
    const body = node.childForFieldName("body");
    const qualifiedName = this.qualify(scope, name);
    const isExported = node.type === "internal_module" && this.isExported(name, scope, exported);
    this.ctx.register({
      name,
      qualifiedName,
      kind: "namespace",
      signature: this.ctx.signature(node.startIndex, body?.startIndex ?? node.endIndex),
      extent: outer,
      extentStart: extendOverPrefix(outer),
      body: null,
      exported: isExported,
    });
    if (body) {
      this.statements(body.namedChildren, {
        prefix: qualifiedName,
        topLevel: false,
        exportable: isExported,
      });
    }
  }

  private expressionStatement(node: SyntaxNode, scope: Scope): boolean {
    const expression = node.namedChildren[0];
    if (!expression) return false;
    if (expression.type === "internal_module") {
      this.namespace(expression, scope, false, node);
      return true;
    }
    if (!scope.topLevel || expression.type !== "assignment_expression") return false;
    const target = expression.childForFieldName("left")?.text ?? "";
    const value = expression.childForFieldName("right");
    const isModuleExports = target === "module.exports";
    if (!value || !(isModuleExports || /^(module\.)?exports\.[\w$]+$/.test(target))) return false;

    const name = isModuleExports ? "default" : target.slice(target.lastIndexOf(".") + 1);
    if (FUNCTION_VALUES.has(value.type)) {
      this.functionValue(name, value, scope, true, node, `${target} =`);
    } else {
      const handle = this.ctx.register({
        name,
        qualifiedName: this.qualify(scope, name),
        kind: "variable",
        signature: target,
        extent: node,
        extentStart: extendOverPrefix(node),
        body: value.text,
        exported: true,
      });
      this.elideValue(value, handle, VALUE_LIMITS);
    }
    if (isModuleExports && value.type === "object") {
      for (const property of value.namedChildren) {
        const key =
          property.type === "shorthand_property_identifier"
            ? property.text
            : property.childForFieldName("key")?.text;
        if (key) this.ctx.addExport(key);
      }
    }
    return true;
  }

  private elideBlock(body: SyntaxNode, handle: string): void {
    if (body.type !== "statement_block") {
      this.ctx.plan.replaceSpan(body, {
        1: inlinePlaceholder(handle),
        2: inlinePlaceholder(handle),
      });
      return;
    }
    if (body.namedChildCount === 0 && isCompact(body.text)) return;
    const placeholder = blockPlaceholder(handle);
    this.ctx.plan.replaceSpan(body, { 1: placeholder, 2: placeholder });
  }

  private elideFunction(fn: SyntaxNode, handle: string): void {
    const body = fn.childForFieldName("body");
    if (body) this.elideBlock(body, handle);
  }

  private elideValue(value: SyntaxNode, handle: string | null, limits: InlineLimits): void {
    const text = value.text;
    const placeholder = handle === null ? ELIDED_VALUE : inlinePlaceholder(handle);
    const replacements: LevelReplacements = {};
    if (!isSingleLine(text) || text.length > limits.signatures) replacements[1] = ` ${placeholder}`;
    if (text.length > limits.contracts) replacements[2] = ` ${placeholder}`;
    if (replacements[1] !== undefined || replacements[2] !== undefined) {
      this.ctx.plan.replace(this.ctx.valueStart(value), value.endIndex, replacements);
    }
    this.elideNestedFunctionBodies(value);
  }

  private elideNestedFunctionBodies(value: SyntaxNode): void {
    for (const fn of value.descendantsOfType([...FUNCTION_VALUES, "method_definition"])) {
      const body = fn.childForFieldName("body");
      if (!body || body.type !== "statement_block") continue;
      if (body.namedChildCount === 0 && isCompact(body.text)) continue;
      this.ctx.plan.replaceSpan(body, { 1: "{ … }", 2: "{ … }" });
    }
  }
}

export function extractEcmaScript(root: SyntaxNode, ctx: ExtractionContext): void {
  const localExports = collectLocalExports(root);
  for (const name of localExports.names) ctx.addExport(name);
  const walker = new EcmaScriptWalker(ctx, localExports);
  walker.statements(root.namedChildren, { prefix: null, topLevel: true, exportable: true });
  walker.dropComments(root);
}

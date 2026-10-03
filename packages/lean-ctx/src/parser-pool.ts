import type Parser from "tree-sitter";
import { loadGrammar, loadParserConstructor } from "./grammars";
import type { LanguageId } from "./languages";
import { JAVASCRIPT_IMPORTS_QUERY, TYPESCRIPT_IMPORTS_QUERY } from "./queries/ecmascript";
import { PYTHON_IMPORTS_QUERY } from "./queries/python";

function importsQuerySource(language: LanguageId): string {
  switch (language) {
    case "python":
      return PYTHON_IMPORTS_QUERY;
    case "javascript":
      return JAVASCRIPT_IMPORTS_QUERY;
    case "typescript":
    case "tsx":
      return TYPESCRIPT_IMPORTS_QUERY;
  }
}

export class ParserPool {
  private readonly ParserClass = loadParserConstructor();
  private readonly parsers = new Map<LanguageId, Parser>();
  private readonly importQueries = new Map<LanguageId, Parser.Query>();

  parse(language: LanguageId, source: string): Parser.Tree {
    return this.parserFor(language).parse(source);
  }

  importsQuery(language: LanguageId): Parser.Query {
    let query = this.importQueries.get(language);
    if (!query) {
      query = new this.ParserClass.Query(loadGrammar(language), importsQuerySource(language));
      this.importQueries.set(language, query);
    }
    return query;
  }

  private parserFor(language: LanguageId): Parser {
    let parser = this.parsers.get(language);
    if (!parser) {
      parser = new this.ParserClass();
      parser.setLanguage(loadGrammar(language));
      this.parsers.set(language, parser);
    }
    return parser;
  }
}

import Foundation
@testable import SokosumiChat
import SwiftTreeSitter
import Testing
import TreeSitterDiff
import TreeSitterGraphQL
import TreeSitterIni
import TreeSitterJSON
import TreeSitterJSONQueries
import TreeSitterKotlin
import TreeSitterLess
import TreeSitterMake
import TreeSitterObjc
import TreeSitterSwift
import TreeSitterSwiftQueries
import TreeSitterXML

struct NativeSyntaxDependencyTests {
  @Test func swiftHighlightsUnicodeSource() throws {
    let source = "let greeting = \"Hello 👋\""
    let captures = try highlight(source, language: tree_sitter_swift(), queryURL: TreeSitterSwiftQueries.Query.highlightsFileURL)
    #expect(captures.contains { $0.0.hasPrefix("keyword") && $0.1 == "let" })
    #expect(captures.contains { $0.0.hasPrefix("string") && $0.1.contains("👋") })
  }

  @Test func jsonHighlightsWithoutEditorFrameworks() throws {
    let captures = try highlight("{\"count\": 42}", language: tree_sitter_json(), queryURL: TreeSitterJSONQueries.Query.highlightsFileURL)
    #expect(captures.contains { $0.0 == "number" && $0.1 == "42" })
  }

  @Test func additionalGrammarsParseUnicodeSource() throws {
    let fixtures: [(OpaquePointer, String)] = [
      (tree_sitter_kotlin(), "val greeting = \"Hello 👋\""),
      (tree_sitter_objc(), "void greet(void) { NSString *s = @\"Hello 👋\"; }"),
      (tree_sitter_xml(), "<greeting>Hello 👋</greeting>"),
      (tree_sitter_make(), "all:\n\techo 'Hello 👋'\n"),
      (tree_sitter_diff(), "diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-old\n+Hello 👋\n"),
      (tree_sitter_ini(), "[greeting]\nmessage=Hello 👋\n")
    ]
    for (pointer, source) in fixtures {
      let parser = Parser()
      try parser.setLanguage(Language(language: pointer))
      let tree = try #require(parser.parse(source))
      let root = try #require(tree.rootNode)
      #expect(!root.hasError)
      #expect(root.range == NSRange(location: 0, length: (source as NSString).length))
    }
  }

  @Test func graphqlHighlightsQueriesAndUnicodeStrings() throws {
    let source = "query Greeting($id: ID!) { user(id: $id, greeting: \"Hello 👋\") { name } }"
    let url = try #require(Bundle.module.url(forResource: "graphql-highlights", withExtension: "scm", subdirectory: "GrammarDependencies"))
    let captures = try highlight(source, language: tree_sitter_graphql(), queryURL: url)
    #expect(captures.contains { $0.0 == "keyword" && $0.1 == "query" })
    #expect(captures.contains { $0.0 == "property" && $0.1 == "name" })
    #expect(captures.contains { $0.0 == "string" && $0.1.contains("👋") })
  }

  @Test func lessHighlightsVariablesAndNestedSelectors() throws {
    let source = "@color: #fff; .greeting { color: @color; content: \"Hello 👋\"; &:hover { width: 2px; } }"
    let url = try #require(Bundle.module.url(forResource: "less-highlights", withExtension: "scm", subdirectory: "GrammarDependencies"))
    let captures = try highlight(source, language: tree_sitter_less(), queryURL: url)
    #expect(captures.contains { $0.0 == "property" && $0.1 == "color" })
    #expect(captures.contains { $0.0 == "number" && $0.1 == "2px" })
    #expect(captures.contains { $0.0 == "type" && $0.1 == "px" })
    #expect(captures.contains { $0.0 == "variable" && $0.1 == "@color" })
    #expect(captures.contains { $0.0 == "attribute" && $0.1 == "hover" })
    #expect(captures.contains { $0.0 == "string" && $0.1.contains("👋") })
  }

  private func highlight(_ source: String, language: OpaquePointer, queryURL: URL) throws -> [(String, String)] {
    let parser = Parser()
    let language = Language(language: language)
    try parser.setLanguage(language)
    let tree = try #require(parser.parse(source))
    let root = try #require(tree.rootNode)
    #expect(!root.hasError)
    #expect(root.range == NSRange(location: 0, length: (source as NSString).length))
    let query = try SwiftTreeSitter.Query(language: language, url: queryURL)
    return query.execute(in: tree).resolve(with: Predicate.Context(string: source)).flatMap { match in
      match.captures.compactMap { capture -> (String, String)? in
        guard let name = capture.name else { return nil }
        return (name, (source as NSString).substring(with: capture.node.range))
      }
    }
  }
}

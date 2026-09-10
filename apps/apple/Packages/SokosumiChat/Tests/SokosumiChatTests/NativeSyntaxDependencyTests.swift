import Foundation
import SwiftTreeSitter
import Testing
import TreeSitterJSON
import TreeSitterJSONQueries
import TreeSitterSwift
import TreeSitterSwiftQueries

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

  private func highlight(_ source: String, language: OpaquePointer, queryURL: URL) throws -> [(String, String)] {
    let parser = Parser()
    let language = Language(language: language)
    try parser.setLanguage(language)
    let tree = try #require(parser.parse(source))
    let query = try SwiftTreeSitter.Query(language: language, url: queryURL)
    return query.execute(in: tree).resolve(with: Predicate.Context(string: source)).flatMap { match in
      match.captures.compactMap { capture -> (String, String)? in
        guard let name = capture.name else { return nil }
        return (name, (source as NSString).substring(with: capture.node.range))
      }
    }
  }
}

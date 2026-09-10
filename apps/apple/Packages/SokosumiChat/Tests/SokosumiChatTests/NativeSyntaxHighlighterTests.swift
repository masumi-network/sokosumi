import Foundation
import SokosumiChat
import Testing

struct NativeSyntaxHighlighterTests {
  @Test func highlightsKotlinUnicodeAndComments() throws {
    let source = "val greeting = \"Hello 👋\" // welcome\nval answer = 42"
    let captures = try NativeSyntaxHighlighter.captures(in: source, language: .kotlin)
    func contains(_ name: String, _ text: String) -> Bool {
      captures.contains { $0.name == name && (source as NSString).substring(with: $0.range) == text }
    }
    #expect(contains("keyword", "val"))
    #expect(contains("string", "\"Hello 👋\""))
    #expect(contains("comment", "// welcome"))
    #expect(contains("number", "42"))
  }

  @Test func highlightsSwiftAndJSONThroughSharedAPI() throws {
    let swift = "let text = \"👋\""
    let swiftCaptures = try NativeSyntaxHighlighter.captures(in: swift, language: .swift)
    #expect(swiftCaptures.contains { $0.name.hasPrefix("keyword") && (swift as NSString).substring(with: $0.range) == "let" })
    let json = "{\"emoji\": \"👋\", \"count\": 42}"
    let jsonCaptures = try NativeSyntaxHighlighter.captures(in: json, language: .json)
    #expect(jsonCaptures.contains { $0.name == "number" && (json as NSString).substring(with: $0.range) == "42" })
  }

  @Test(arguments: [SyntaxLanguage.swift, .json, .kotlin])
  func acceptsIncompleteAndEmptySource(language: SyntaxLanguage) throws {
    #expect(try NativeSyntaxHighlighter.captures(in: "", language: language).isEmpty)
    let source = "let message = \"👋"
    let captures = try NativeSyntaxHighlighter.captures(in: source, language: language)
    #expect(captures.allSatisfy { $0.range.location >= 0 && NSMaxRange($0.range) <= (source as NSString).length })
  }
}

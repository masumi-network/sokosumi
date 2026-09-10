import Foundation
import SokosumiChat
import Testing

struct NativeSyntaxHighlighterTests {
  @Test func resolvesFenceInfoWithoutMislabelingUnknownLanguages() {
    #expect(SyntaxLanguage(fenceInfo: "Swift title=example") == .swift)
    #expect(SyntaxLanguage(fenceInfo: " KT ") == .kotlin)
    #expect(SyntaxLanguage(fenceInfo: "kts") == .kotlin)
    #expect(SyntaxLanguage(fenceInfo: "json") == .json)
    #expect(SyntaxLanguage(fenceInfo: "jsonc") == nil)
    #expect(SyntaxLanguage(fenceInfo: "") == nil)
  }

  @Test func highlightsAdditionalPackagedLanguages() throws {
    let fixtures: [(SyntaxLanguage, String)] = [
      (.bash, "echo 'hello'"), (.c, "int answer = 42;"), (.cpp, "class Example {};"),
      (.csharp, "class Example { int answer = 42; }"), (.css, "body { color: red; }"),
      (.go, "package main\nfunc main() {}"), (.java, "class Example { int answer = 42; }"),
      (.javascript, "const answer = 42;"), (.lua, "local answer = 42"),
      (.markdown, "# Heading"), (.perl, "my $answer = 42;"), (.php, "<?php echo 42;"),
      (.python, "answer = 42"), (.r, "answer <- 42"), (.ruby, "answer = 42"),
      (.rust, "fn main() { let answer = 42; }"), (.scss, "$color: red;"),
      (.sql, "SELECT 42;"), (.typescript, "const answer: number = 42;"), (.yaml, "answer: 42")
    ]
    for (language, source) in fixtures {
      let captures = try NativeSyntaxHighlighter.captures(in: source, language: language)
      #expect(!captures.isEmpty, "Missing captures for \(language)")
      #expect(captures.allSatisfy { NSMaxRange($0.range) <= (source as NSString).length })
    }
  }

  @Test func highlightsSCSSVariables() throws {
    let source = "$color: red; body { color: $color; }"
    let captures = try NativeSyntaxHighlighter.captures(in: source, language: .scss)
    let variables = captures.filter { $0.name == "variable" }.map { (source as NSString).substring(with: $0.range) }
    #expect(variables == ["$color", "$color"])
  }

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

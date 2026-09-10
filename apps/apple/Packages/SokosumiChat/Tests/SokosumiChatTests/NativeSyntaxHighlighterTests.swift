import Foundation
import SokosumiChat
import Testing

struct NativeSyntaxHighlighterTests {
  @Test func resolvesFenceInfoWithoutMislabelingUnknownLanguages() {
    #expect(SyntaxLanguage(fenceInfo: "Swift title=example") == .swift)
    #expect(SyntaxLanguage(fenceInfo: " KT ") == .kotlin)
    #expect(SyntaxLanguage(fenceInfo: "kts") == .kotlin)
    #expect(SyntaxLanguage(fenceInfo: "json") == .json)
    #expect(SyntaxLanguage(fenceInfo: "jsonc") == .json)
    #expect(SyntaxLanguage(fenceInfo: "unknown-language") == nil)
    #expect(SyntaxLanguage(fenceInfo: "") == nil)
  }

  @Test func resolvesCommonAliasesAndDistinctDialects() {
    let fixtures: [(String, SyntaxLanguage)] = [
      ("graphql", .graphql), ("LESS", .less), ("JS", .javascript), ("py", .python), ("objc", .objectivec),
      ("jsp", .java), ("ipython", .python), ("obj-c++", .objectivec), ("objective-c++", .objectivec),
      ("c++", .cpp), ("c#", .csharp), ("sh", .bash), ("md", .markdown),
      ("yml", .yaml), ("rs", .rust), ("make", .makefile), ("patch", .diff),
      ("html", .html), ("toml", .toml), ("tsx", .tsx), ("svg", .xml)
    ]
    for (alias, expected) in fixtures {
      #expect(SyntaxLanguage(fenceInfo: alias + " title=example") == expected)
    }
  }

  @Test func highlightsGraphQLAndLESSFromBundledQueries() throws {
    let fixtures: [SyntaxLanguage: (String, String)] = [
      .graphql: ("query Greeting { hello(message: \"👋\") }", "query"),
      .less: ("@color: red; .hello { color: @color; content: \"👋\"; }", "@color")
    ]
    for (language, (source, token)) in fixtures {
      let name = language == .graphql ? "keyword" : "variable"
      let captures = try NativeSyntaxHighlighter.captures(in: source, language: language)
      #expect(captures.contains { $0.name == name && (source as NSString).substring(with: $0.range) == token })
      #expect(captures.contains { $0.name == "string" && (source as NSString).substring(with: $0.range).contains("👋") })
    }
  }

  @Test func highlightsDialectSpecificSyntax() throws {
    let fixtures: [SyntaxLanguage: (String, String)] = [
      .html: ("<input disabled><br><p>Hello</p>", "input"),
      .toml: ("created = 2026-09-10T12:00:00Z", "2026-09-10T12:00:00Z"),
      .tsx: ("const view: JSX.Element = <div>Hello</div>;", "div"),
      .javascript: ("const view = <button>Hello</button>;", "button"),
      .json: ("{\"count\": 42 // comment\n}", "// comment")
    ]
    for (language, (source, expected)) in fixtures {
      let captures = try NativeSyntaxHighlighter.captures(in: source, language: language)
      #expect(captures.contains { (source as NSString).substring(with: $0.range) == expected })
    }
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

  @Test func highlightsAdditionalUpstreamResources() throws {
    let fixtures: [(SyntaxLanguage, String)] = [
      (.objectivec, "@interface Example : NSObject\n@end\nint answer = 42;"),
      (.xml, "<message greeting=\"hello\">👋</message>"),
      (.makefile, "all: build\n\techo hello\n"),
      (.diff, "--- old\n+++ new\n@@ -1 +1 @@\n-old\n+new\n"),
      (.ini, "[settings]\nanswer = 42\n")
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

  @Test func highlightsKotlinDeclarationsAndControlFlow() throws {
    let source = """
    // 👋 Keep UTF-16 offsets correct after non-BMP text.
    class Greeter
    object Registry
    typealias Count = Int
    inline fun <reified T> greet(value: T): Int {
      for (item in listOf(1, 2)) {
        if (item == 1) continue
        break
      }
      return 42
    }
    """
    let captures = try NativeSyntaxHighlighter.captures(in: source, language: .kotlin)
    for (name, text) in [
      ("type", "Greeter"), ("type", "Registry"), ("type", "Count"),
      ("type", "Int"), ("type", "T"), ("function", "greet"),
      ("keyword", "reified"), ("keyword", "continue"), ("keyword", "break")
    ] {
      #expect(captures.contains { $0.name == name && (source as NSString).substring(with: $0.range) == text }, "Missing \(name): \(text)")
    }
    let literal = "val text = \"class Greeter fun greet break continue reified\""
    let literalCaptures = try NativeSyntaxHighlighter.captures(in: literal, language: .kotlin)
    #expect(!literalCaptures.contains { $0.name == "type" || $0.name == "function" })
    #expect(literalCaptures.filter { $0.name == "keyword" }.count == 1)
  }

  @Test func highlightsKotlinBracedInterpolationAndAnnotations() throws {
    let source = #"""
    @file:JvmName("Example")
    @Deprecated("Use greeting instead")
    fun greet(name: String) = "👋 $name, ${1 + 2}"
    """#
    let captures = try NativeSyntaxHighlighter.captures(in: source, language: .kotlin)
    for (name, text) in [
      ("attribute", "JvmName"), ("attribute", "Deprecated"),
      ("embedded", "${1 + 2}"),
      ("number", "1"), ("number", "2"),
      ("string", "\"Use greeting instead\"")
    ] {
      #expect(captures.contains { $0.name == name && (source as NSString).substring(with: $0.range) == text }, "Missing \(name): \(text)")
    }
    let annotationOffset = (source as NSString).range(of: "Deprecated").location
    #expect(captures.last { NSLocationInRange(annotationOffset, $0.range) }?.name == "attribute")
    let numberOffset = (source as NSString).range(of: "1 + 2").location
    #expect(captures.last { NSLocationInRange(numberOffset, $0.range) }?.name == "number")
    let escaped = #"val text = "\$name and @Deprecated""#
    let literalCaptures = try NativeSyntaxHighlighter.captures(in: escaped, language: .kotlin)
    #expect(!literalCaptures.contains { $0.name == "embedded" || $0.name == "attribute" })
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

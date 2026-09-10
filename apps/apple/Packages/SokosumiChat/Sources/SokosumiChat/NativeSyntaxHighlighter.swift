import Foundation
import SwiftTreeSitter
import TreeSitterJSON
import TreeSitterJSONQueries
import TreeSitterKotlin
import TreeSitterSwift
import TreeSitterSwiftQueries

/// UI-free capture ranges. Consumers apply platform colors without moving
/// parsing onto the main actor. Ranges use Foundation's UTF-16 coordinates.
public struct SyntaxCapture: Equatable, Sendable {
  public let name: String
  public let range: NSRange
}

public enum SyntaxLanguage: String, Sendable {
  case swift, json, kotlin

  public init?(fenceInfo: String) {
    switch fenceInfo.split(whereSeparator: { $0.isWhitespace }).first?.lowercased() {
    case "swift": self = .swift
    case "json": self = .json
    case "kotlin", "kt", "kts": self = .kotlin
    default: return nil
    }
  }
}

public enum NativeSyntaxHighlighter {
  /// Call from the same background parsing task as the Markdown document.
  /// Incomplete source is valid input while a response is streaming.
  public static func captures(in source: String, language: SyntaxLanguage) throws -> [SyntaxCapture] {
    let pointer: OpaquePointer = switch language {
    case .swift: tree_sitter_swift()
    case .json: tree_sitter_json()
    case .kotlin: tree_sitter_kotlin()
    }
    let grammar = Language(language: pointer)
    let parser = Parser()
    try parser.setLanguage(grammar)
    guard let tree = parser.parse(source) else { return [] }
    let query: SwiftTreeSitter.Query = switch language {
    case .swift:
      try SwiftTreeSitter.Query(language: grammar, url: TreeSitterSwiftQueries.Query.highlightsFileURL)
    case .json:
      try SwiftTreeSitter.Query(language: grammar, url: TreeSitterJSONQueries.Query.highlightsFileURL)
    case .kotlin:
      try SwiftTreeSitter.Query(language: grammar, data: Data(kotlinQuery.utf8))
    }
    return query.execute(in: tree).resolve(with: Predicate.Context(string: source)).flatMap { match in
      match.captures.compactMap { capture in
        guard let name = capture.name else { return nil }
        return SyntaxCapture(name: name, range: capture.node.range)
      }
    }
  }

  /// The pinned Kotlin 1.1.0 package supplies a parser but no queries.
  /// These node/token names are from that release's node-types.json.
  private static let kotlinQuery = #"""
  [(line_comment) (block_comment)] @comment
  [(string_literal) (multiline_string_literal) (character_literal)] @string
  [(number_literal) (float_literal)] @number
  ["abstract" "actual" "annotation" "as" "as?" "by" "catch" "class"
   "companion" "const" "constructor" "crossinline" "data" "do" "dynamic"
   "else" "enum" "expect" "external" "final" "finally" "for" "fun" "get"
   "if" "import" "in" "infix" "init" "inline" "inner" "interface"
   "internal" "is" "lateinit" "noinline" "object" "open" "operator"
   "out" "override" "package" "private" "protected" "public" "return"
   "sealed" "set" "super" "suspend" "tailrec" "this" "throw" "try"
   "typealias" "val" "value" "var" "vararg" "when" "where" "while"] @keyword
  ((identifier) @constant.builtin (#any-of? @constant.builtin "true" "false" "null"))
  """#
}

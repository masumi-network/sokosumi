import Foundation
import SwiftTreeSitter
import TreeSitterBash
import TreeSitterBashQueries
import TreeSitterC
import TreeSitterCPP
import TreeSitterCPPQueries
import TreeSitterCQueries
import TreeSitterCSharp
import TreeSitterCSharpQueries
import TreeSitterCSS
import TreeSitterCSSQueries
import TreeSitterDiff
import TreeSitterGo
import TreeSitterGoQueries
import TreeSitterHTML
import TreeSitterHTMLQueries
import TreeSitterIni
import TreeSitterJava
import TreeSitterJavaQueries
import TreeSitterJavaScript
import TreeSitterJavaScriptQueries
import TreeSitterJSON
import TreeSitterJSONQueries
import TreeSitterKotlin
import TreeSitterLua
import TreeSitterLuaQueries
import TreeSitterMake
import TreeSitterMarkdown
import TreeSitterMarkdownQueries
import TreeSitterObjc
import TreeSitterPerl
import TreeSitterPerlQueries
import TreeSitterPHP
import TreeSitterPHPQueries
import TreeSitterPython
import TreeSitterPythonQueries
import TreeSitterR
import TreeSitterRQueries
import TreeSitterRuby
import TreeSitterRubyQueries
import TreeSitterRust
import TreeSitterRustQueries
import TreeSitterSCSS
import TreeSitterSCSSQueries
import TreeSitterSQL
import TreeSitterSQLQueries
import TreeSitterSwift
import TreeSitterSwiftQueries
import TreeSitterTOML
import TreeSitterTOMLQueries
import TreeSitterTSX
import TreeSitterTSXQueries
import TreeSitterTypeScript
import TreeSitterTypeScriptQueries
import TreeSitterXML
import TreeSitterYAML
import TreeSitterYAMLQueries

/// UI-free capture ranges. Consumers apply platform colors without moving
/// parsing onto the main actor. Ranges use Foundation's UTF-16 coordinates.
public struct SyntaxCapture: Equatable, Sendable {
  public let name: String
  public let range: NSRange
}

public enum SyntaxLanguage: String, Sendable {
  case swift, json, kotlin, objectivec, xml, makefile, diff, ini, html, toml, tsx
  // Standard language names match fenced-code identifiers.
  // swiftlint:disable:next identifier_name
  case bash, c, cpp, csharp, css, go, java, javascript, lua, markdown, perl, php, python, r, ruby, rust, scss, sql, typescript, yaml

  public init?(fenceInfo: String) {
    let name = fenceInfo.split(whereSeparator: { $0.isWhitespace }).first?.lowercased() ?? ""
    self.init(rawValue: Self.aliases[name] ?? name)
  }

  /// Fence aliases from the web registry. Dialects with their own native
  /// grammar (HTML, TOML and TSX) retain distinct cases.
  private static let aliases: [String: String] = [
    "jsonc": "json",
    "kt": "kotlin",
    "kts": "kotlin",
    "objc": "objectivec",
    "obj-c": "objectivec",
    "mm": "objectivec",
    "xhtml": "xml",
    "rss": "xml",
    "atom": "xml",
    "xjb": "xml",
    "xsd": "xml",
    "xsl": "xml",
    "plist": "xml",
    "wsf": "xml",
    "svg": "xml",
    "mk": "makefile",
    "mak": "makefile",
    "make": "makefile",
    "patch": "diff",
    "sh": "bash",
    "zsh": "bash",
    "h": "c",
    "cc": "cpp",
    "c++": "cpp",
    "h++": "cpp",
    "hpp": "cpp",
    "hh": "cpp",
    "hxx": "cpp",
    "cxx": "cpp",
    "cs": "csharp",
    "c#": "csharp",
    "golang": "go",
    "js": "javascript",
    "jsx": "javascript",
    "mjs": "javascript",
    "cjs": "javascript",
    "pluto": "lua",
    "md": "markdown",
    "mkdown": "markdown",
    "mkd": "markdown",
    "pl": "perl",
    "pm": "perl",
    "py": "python",
    "gyp": "python",
    "rb": "ruby",
    "gemspec": "ruby",
    "podspec": "ruby",
    "thor": "ruby",
    "irb": "ruby",
    "rs": "rust",
    "ts": "typescript",
    "mts": "typescript",
    "cts": "typescript",
    "yml": "yaml"
  ]

  fileprivate var pointer: OpaquePointer {
    switch self {
    case .html: tree_sitter_html()
    case .toml: tree_sitter_toml()
    case .tsx: tree_sitter_tsx()
    case .objectivec: tree_sitter_objc()
    case .xml: tree_sitter_xml()
    case .makefile: tree_sitter_make()
    case .diff: tree_sitter_diff()
    case .ini: tree_sitter_ini()
    case .bash: tree_sitter_bash()
    case .c: tree_sitter_c()
    case .cpp: tree_sitter_cpp()
    case .csharp: tree_sitter_c_sharp()
    case .css: tree_sitter_css()
    case .go: tree_sitter_go()
    case .java: tree_sitter_java()
    case .javascript: tree_sitter_javascript()
    case .lua: tree_sitter_lua()
    case .markdown: tree_sitter_markdown()
    case .perl: tree_sitter_perl()
    case .php: tree_sitter_php()
    case .python: tree_sitter_python()
    case .r: tree_sitter_r()
    case .ruby: tree_sitter_ruby()
    case .rust: tree_sitter_rust()
    case .scss: tree_sitter_scss()
    case .sql: tree_sitter_sql()
    case .typescript: tree_sitter_typescript()
    case .yaml: tree_sitter_yaml()
    case .swift: tree_sitter_swift()
    case .json: tree_sitter_json()
    case .kotlin: tree_sitter_kotlin()
    }
  }

  fileprivate var queryURLs: [URL] {
    switch self {
    case .html: [TreeSitterHTMLQueries.Query.highlightsFileURL]
    case .toml: [TreeSitterTOMLQueries.Query.highlightsFileURL]
    case .tsx: [TreeSitterJavaScriptQueries.Query.highlightsFileURL, TreeSitterJavaScriptQueries.Query.highlightsJSXFileURL, TreeSitterTSXQueries.Query.highlightsFileURL]
    case .bash: [TreeSitterBashQueries.Query.highlightsFileURL]
    case .c: [TreeSitterCQueries.Query.highlightsFileURL]
    case .cpp: [TreeSitterCQueries.Query.highlightsFileURL, TreeSitterCPPQueries.Query.highlightsFileURL]
    case .csharp: [TreeSitterCSharpQueries.Query.highlightsFileURL]
    case .css: [TreeSitterCSSQueries.Query.highlightsFileURL]
    case .go: [TreeSitterGoQueries.Query.highlightsFileURL]
    case .java: [TreeSitterJavaQueries.Query.highlightsFileURL]
    case .javascript: [TreeSitterJavaScriptQueries.Query.highlightsFileURL, TreeSitterJavaScriptQueries.Query.highlightsJSXFileURL]
    case .lua: [TreeSitterLuaQueries.Query.highlightsFileURL]
    case .markdown: [TreeSitterMarkdownQueries.Query.highlightsFileURL]
    case .perl: [TreeSitterPerlQueries.Query.highlightsFileURL]
    case .php: [TreeSitterPHPQueries.Query.highlightsFileURL]
    case .python: [TreeSitterPythonQueries.Query.highlightsFileURL]
    case .r: [TreeSitterRQueries.Query.highlightsFileURL]
    case .ruby: [TreeSitterRubyQueries.Query.highlightsFileURL]
    case .rust: [TreeSitterRustQueries.Query.highlightsFileURL]
    case .scss: [TreeSitterSCSSQueries.Query.highlightsFileURL]
    case .sql: [TreeSitterSQLQueries.Query.highlightsFileURL]
    case .typescript: [TreeSitterJavaScriptQueries.Query.highlightsFileURL, TreeSitterTypeScriptQueries.Query.highlightsFileURL]
    case .yaml: [TreeSitterYAMLQueries.Query.highlightsFileURL]
    case .swift: [TreeSitterSwiftQueries.Query.highlightsFileURL]
    case .json: [TreeSitterJSONQueries.Query.highlightsFileURL]
    case .kotlin, .xml, .makefile, .diff, .ini: []
    case .objectivec: [TreeSitterCQueries.Query.highlightsFileURL]
    }
  }
}

public enum NativeSyntaxHighlighter {
  /// Call from the same background parsing task as the Markdown document.
  /// Incomplete source is valid input while a response is streaming.
  public static func captures(in source: String, language: SyntaxLanguage) throws -> [SyntaxCapture] {
    let grammar = Language(language: language.pointer)
    let parser = Parser()
    try parser.setLanguage(grammar)
    guard let tree = parser.parse(source) else { return [] }
    let data = try language == .kotlin ? Data(kotlinQuery.utf8) : combinedQueries(for: language)
    let query = try SwiftTreeSitter.Query(language: grammar, data: data)
    let captures: [SyntaxCapture] = query.execute(in: tree).resolve(with: Predicate.Context(string: source)).flatMap { match in
      match.captures.compactMap { capture in
        guard let name = capture.name else { return nil }
        return SyntaxCapture(name: name, range: capture.node.range)
      }
    }
    // Kotlin annotation names are also user_type identifiers. Keep the more
    // specific annotation capture so generic type styling cannot overwrite it.
    if language == .kotlin {
      let annotations = Set(captures.filter { $0.name == "attribute" }.map(\.range))
      return captures.filter { $0.name != "type" || !annotations.contains($0.range) }
    }
    return captures
  }

  private static func combinedQueries(for language: SyntaxLanguage) throws -> Data {
    var source = try language.queryURLs.map { try String(contentsOf: $0, encoding: .utf8) }.joined(separator: "\n")
    // TreeSitterLanguages 0.1.10 SCSS queries omit the predicate prefix.
    // Correct the query input, never the dependency's generated files.
    if language == .scss {
      source = source.replacingOccurrences(of: "(match? ", with: "(#match? ")
      source += "\n[(variable_name) (variable_value)] @variable"
    }
    let resourceName: String? = switch language {
    case .objectivec: "objc"
    case .xml: "xml"
    case .makefile: "make"
    case .diff: "diff"
    case .ini: "ini"
    default: nil
    }
    if let resourceName {
      guard let url = Bundle.module.url(forResource: resourceName, withExtension: "scm", subdirectory: "HighlightQueries") else {
        throw CocoaError(.fileNoSuchFile)
      }
      try source += "\n" + String(contentsOf: url, encoding: .utf8)
    }
    return Data(source.utf8)
  }

  /// The pinned Kotlin 1.1.0 package supplies a parser but no queries.
  /// These node/token names are from that release's node-types.json.
  private static let kotlinQuery = #"""
  [(line_comment) (block_comment)] @comment
  [(string_literal) (multiline_string_literal) (character_literal)] @string
  (interpolation) @embedded
  [(number_literal) (float_literal)] @number
  (reification_modifier) @keyword
  ((identifier) @keyword (#any-of? @keyword "break" "continue"))
  (function_declaration name: (identifier) @function)
  (class_declaration name: (identifier) @type)
  (object_declaration name: (identifier) @type)
  (type_alias type: (identifier) @type)
  (user_type (identifier) @type)
  (annotation (user_type (identifier) @attribute))
  (annotation (constructor_invocation (user_type (identifier) @attribute)))
  (file_annotation (user_type (identifier) @attribute))
  (file_annotation (constructor_invocation (user_type (identifier) @attribute)))
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

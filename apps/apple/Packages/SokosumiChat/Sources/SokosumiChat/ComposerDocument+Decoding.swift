import Markdown

public extension ComposerDocument {
  /// Unsupported structures fail explicitly so callers can preserve the original draft.
  enum DecodingError: Error {
    case unsupportedStructure
  }

  init(markdown: String) throws {
    let document = Markdown.Document(parsing: markdown)
    let nodes = Array(document.children)
    blocks = try Self.decodeBlocks(nodes)
    if let firstLine = nodes.first?.range?.lowerBound.line {
      blocks.insert(contentsOf: Array(repeating: .blankLine, count: max(0, firstLine - 1)), at: 0)
    }
    if let last = nodes.last, let lastLine = Self.lastContentLine(last) {
      let lineCount = markdown.split(separator: "\n", omittingEmptySubsequences: false).count
      blocks += Array(repeating: .blankLine, count: max(0, lineCount - lastLine - 1))
    }
  }
}

private extension ComposerDocument {
  static func decodeBlocks(_ nodes: [any Markup]) throws -> [Block] {
    var result: [Block] = []
    var previousLine: Int?
    for node in nodes {
      if let previousLine, let line = node.range?.lowerBound.line {
        result += Array(repeating: .blankLine, count: max(0, line - previousLine - 1))
      }
      try result.append(decodeBlock(node))
      previousLine = lastContentLine(node)
    }
    return result
  }

  static func lastContentLine(_ node: any Markup) -> Int? {
    // List/container ranges can include the blank line following their final item.
    if node is OrderedList || node is UnorderedList || node is ListItem || node is BlockQuote,
       let child = Array(node.children).last {
      return lastContentLine(child)
    }
    return node.range?.upperBound.line
  }

  static func decodeBlock(_ node: any Markup) throws -> Block {
    switch node {
    case let paragraph as Paragraph:
      return try .paragraph(decodeInline(Array(paragraph.children)))
    case let heading as Heading:
      return try .heading(decodeInline(Array(heading.children)), level: heading.level)
    case let quote as BlockQuote:
      return try .quote(decodeBlocks(Array(quote.children)))
    case let list as UnorderedList:
      return try .unorderedList(list.children.map(decodeListItem))
    case let list as OrderedList:
      return try .orderedList(list.children.map(decodeListItem))
    case let code as CodeBlock:
      var text = code.code
      if text.hasSuffix("\n") {
        text.removeLast()
      }
      return .code(text, language: code.language ?? "")
    default:
      throw DecodingError.unsupportedStructure
    }
  }

  static func decodeListItem(_ node: any Markup) throws -> [Block] {
    guard let item = node as? ListItem, item.checkbox == nil else {
      throw DecodingError.unsupportedStructure
    }
    return try decodeBlocks(Array(item.children))
  }

  static func decodeInline(_ nodes: [any Markup]) throws -> [Inline] {
    var result: [Inline] = []
    var index = 0
    while index < nodes.count {
      let node = nodes[index]
      if let html = node as? InlineHTML, html.rawHTML.lowercased() == "<u>" {
        let end = try underlineEnd(in: nodes, after: index)
        try result.append(.underline(decodeInline(Array(nodes[(index + 1) ..< end]))))
        index = end + 1
        continue
      }
      switch node {
      case let text as Markdown.Text:
        result.append(.text(text.string))
      case is SoftBreak, is LineBreak:
        result.append(.text("\n"))
      case let strong as Strong:
        try result.append(.bold(decodeInline(Array(strong.children))))
      case let emphasis as Emphasis:
        try result.append(.italic(decodeInline(Array(emphasis.children))))
      case let strike as Strikethrough:
        try result.append(.strikethrough(decodeInline(Array(strike.children))))
      case let code as InlineCode:
        result.append(.code(code.code))
      case let link as Markdown.Link:
        try result.append(.link(decodeInline(Array(link.children)), destination: link.destination ?? ""))
      default:
        throw DecodingError.unsupportedStructure
      }
      index += 1
    }
    return result
  }

  static func underlineEnd(in nodes: [any Markup], after start: Int) throws -> Int {
    var depth = 1
    for index in (start + 1) ..< nodes.count {
      guard let tag = nodes[index] as? InlineHTML else { continue }
      switch tag.rawHTML.lowercased() {
      case "<u>": depth += 1
      case "</u>": depth -= 1
      default: break
      }
      if depth == 0 {
        return index
      }
    }
    throw DecodingError.unsupportedStructure
  }
}

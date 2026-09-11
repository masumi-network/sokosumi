import Foundation

/// Editable message structure, independent of platform fonts and text views.
public struct ComposerDocument: Equatable, Sendable {
  public var blocks: [Block]

  public init(blocks: [Block]) {
    self.blocks = blocks
  }

  public indirect enum Inline: Equatable, Sendable {
    case text(String)
    case bold([Inline])
    case italic([Inline])
    case underline([Inline])
    case strikethrough([Inline])
    case code(String)
    case link([Inline], destination: String)
  }

  public indirect enum Block: Equatable, Sendable {
    case blankLine
    case paragraph([Inline])
    case heading([Inline], level: Int)
    case quote([Block])
    case unorderedList([[Block]])
    case orderedList([[Block]])
    case code(String, language: String)
  }

  /// Matches the web composer's persisted Markdown and underline HTML convention.
  public var markdown: String {
    let result = blocks.map(\.markdown).joined().replacingOccurrences(of: "\r", with: "")
    return ComposerContent(result).text.isEmpty ? "" : result
  }
}

private extension ComposerDocument.Inline {
  var markdown: String {
    switch self {
    case let .text(text):
      return text.replacingOccurrences(of: "\u{200B}", with: "")
    case let .bold(children):
      return wrap(children, opening: "**", closing: "**")
    case let .italic(children):
      return wrap(children, opening: "_", closing: "_")
    case let .underline(children):
      return wrap(children, opening: "<u>", closing: "</u>")
    case let .strikethrough(children):
      return wrap(children, opening: "~~", closing: "~~")
    case let .code(text):
      return text.contains("\n") ? fencedCode(text, language: "") : wrap([.text(text)], opening: "`", closing: "`")
    case let .link(children, destination):
      let escaped = destination.replacingOccurrences(of: "\\", with: "\\\\")
        .replacingOccurrences(of: ")", with: "\\)")
      return "[\(inlineMarkdown(children))](\(escaped))"
    }
  }

  func wrap(_ children: [Self], opening: String, closing: String) -> String {
    let content = inlineMarkdown(children)
    let inner = ComposerContent(content).text
    guard !inner.isEmpty, let range = content.range(of: inner) else { return content }
    return String(content[..<range.lowerBound]) + opening + inner + closing + String(content[range.upperBound...])
  }
}

private extension ComposerDocument.Block {
  var markdown: String {
    switch self {
    case .blankLine:
      return "\n"
    case let .paragraph(children):
      let text = inlineMarkdown(children)
      return text.hasSuffix("\n") ? text : text + "\n"
    case let .heading(children, level):
      return String(repeating: "#", count: min(max(level, 1), 6)) + " " + inlineMarkdown(children) + "\n"
    case let .quote(blocks):
      var text = blocks.map(\.markdown).joined().replacingOccurrences(of: "\r", with: "")
      if text.hasSuffix("\n") {
        text.removeLast()
      }
      return text.components(separatedBy: "\n").map { "> " + $0 }.joined(separator: "\n") + "\n"
    case let .unorderedList(items):
      return list(items, ordered: false)
    case let .orderedList(items):
      return list(items, ordered: true)
    case let .code(text, language):
      return fencedCode(text, language: language)
    }
  }

  func list(_ items: [[Self]], ordered: Bool) -> String {
    items.enumerated().map { index, blocks in
      let prefix = ordered ? "\(index + 1). " : "- "
      let lines = ComposerContent(blocks.map(\.markdown).joined()).text.components(separatedBy: "\n")
      return prefix + lines.joined(separator: "\n" + String(repeating: " ", count: prefix.count))
    }.joined(separator: "\n") + "\n"
  }
}

private func fencedCode(_ text: String, language: String) -> String {
  var longest = 0
  var current = 0
  for character in text {
    current = character == "`" ? current + 1 : 0
    longest = max(longest, current)
  }
  let fence = String(repeating: "`", count: max(3, longest + 1))
  return "\(fence)\(ComposerContent(language).text)\n\(text)\n\(fence)\n"
}

private func inlineMarkdown(_ children: [ComposerDocument.Inline]) -> String {
  children.reduce(into: "") { output, child in
    if case let .code(text) = child, text.contains("\n"), !output.isEmpty, !output.hasSuffix("\n") {
      output += "\n"
    }
    output += child.markdown
  }
}

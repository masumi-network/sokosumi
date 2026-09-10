import Foundation
import Markdown

/// A single caret-local edit. Ranges use UTF-16, matching native text input and web.
public struct ComposerEmoji: Equatable, Sendable {
  public let range: NSRange
  public let replacement: String

  public static func match(in text: String, caret: Int, flush: Bool = false) -> Self? {
    guard let edit = candidate(in: text, caret: caret, flush: flush) else { return nil }
    let prefix = (text as NSString).substring(to: edit.range.location)
    let lines = prefix.components(separatedBy: "\n")
    let location = SourceLocation(line: lines.count, column: (lines.last?.utf8.count ?? 0) + 1, source: nil)
    guard !isCode(Document(parsing: text), at: location) else { return nil }
    return edit
  }

  private static func isCode(_ node: any Markup, at location: SourceLocation) -> Bool {
    if node is CodeBlock || node is InlineCode,
       let range = node.range, range.contains(location) {
      return true
    }
    return node.children.contains { isCode($0, at: location) }
  }

  private static func candidate(in text: String, caret: Int, flush: Bool) -> Self? {
    let source = text as NSString
    let caret = min(max(caret, 0), source.length)
    if !flush, let shortcode = shortcode(in: source, caret: caret) {
      return shortcode
    }
    let end: Int
    if flush, caret == source.length {
      end = caret
    } else if caret > 0, isBoundary(source.substring(with: NSRange(location: caret - 1, length: 1))) {
      end = caret - 1
    } else {
      return nil
    }
    let prefix = source.substring(to: end)
    for entry in MessageEmoji.composerEmoticons where prefix.hasSuffix(entry.text) {
      let start = end - entry.text.utf16.count
      guard start == 0 || isWhitespace(source.substring(with: NSRange(location: start - 1, length: 1))) else { continue }
      return Self(range: NSRange(location: start, length: caret - start),
                  replacement: entry.emoji + source.substring(with: NSRange(location: end, length: caret - end)))
    }
    return nil
  }

  public static func preparingToSend(_ text: String) -> String {
    guard let edit = match(in: text, caret: text.utf16.count, flush: true) else { return text }
    return (text as NSString).replacingCharacters(in: edit.range, with: edit.replacement)
  }

  private static func shortcode(in source: NSString, caret: Int) -> Self? {
    guard caret >= 3, source.character(at: caret - 1) == 58 else { return nil }
    for index in stride(from: caret - 2, through: 0, by: -1) {
      let char = source.substring(with: NSRange(location: index, length: 1))
      if isWhitespace(char) {
        return nil
      }
      guard char == ":" else { continue }
      guard index == 0 || isWhitespace(source.substring(with: NSRange(location: index - 1, length: 1))) else { return nil }
      let name = source.substring(with: NSRange(location: index + 1, length: caret - index - 2))
      guard let emoji = MessageEmoji.emoji(shortcode: name) else { return nil }
      let appendSpace = caret == source.length || !isWhitespace(source.substring(with: NSRange(location: caret, length: 1)))
      return Self(range: NSRange(location: index, length: caret - index), replacement: emoji + (appendSpace ? " " : ""))
    }
    return nil
  }

  private static func isBoundary(_ char: String) -> Bool {
    isWhitespace(char) || [".", "!", "?", ",", ";", ":"].contains(char)
  }

  private static func isWhitespace(_ char: String) -> Bool {
    ComposerContent(char).text.isEmpty
  }
}

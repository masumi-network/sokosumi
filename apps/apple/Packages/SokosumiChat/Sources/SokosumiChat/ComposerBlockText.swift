import Foundation

/// Block identities travel with text edits; display prefixes never become message content.
public enum ComposerBlockText {
  public static let path = NSAttributedString.Key("com.sokosumi.composer.blockPath")
  public static let listMarker = NSAttributedString.Key("com.sokosumi.composer.listMarker")

  public struct QuoteExit {
    public let range: NSRange
    public let replacement: NSAttributedString
    public let caret: Int
  }

  /// Leaves the innermost quote only from its empty last line, matching web.
  public static func exitingQuote(_ text: NSAttributedString, selection: NSRange)
    -> QuoteExit? {
    guard selection.length == 0, text.length > 0, selection.location <= text.length else { return nil }
    let probe = min(selection.location, text.length - 1)
    guard let tokens = text.attribute(path, at: probe, effectiveRange: nil) as? [String],
          let quoteIndex = tokens.lastIndex(where: { $0.hasSuffix(":q") }) else { return nil }
    let ancestors = Array(tokens.prefix(quoteIndex + 1))
    var start = probe
    var end = probe + 1
    func belongs(_ index: Int) -> Bool {
      let candidate = text.attribute(path, at: index, effectiveRange: nil) as? [String] ?? []
      return candidate.starts(with: ancestors)
    }
    while start > 0, belongs(start - 1) {
      start -= 1
    }
    while end < text.length, belongs(end) {
      end += 1
    }
    let source = text.string as NSString
    let prefix = source.substring(with: NSRange(location: start, length: selection.location - start))
    let tail = source.substring(with: NSRange(location: selection.location, length: end - selection.location))
    guard ComposerContent(prefix.components(separatedBy: "\n").last ?? "").text.isEmpty,
          ComposerContent(tail).text.isEmpty else { return nil }
    var contentEnd = selection.location
    while contentEnd > start,
          ComposerContent(source.substring(with: NSRange(location: contentEnd - 1, length: 1))).text.isEmpty {
      contentEnd -= 1
    }
    let replacement = NSMutableAttributedString(string: "")
    if contentEnd > start {
      replacement.append(text.attributedSubstring(from: NSRange(location: start, length: contentEnd - start)))
      replacement.append(NSAttributedString(string: "\n", attributes: [path: tokens]))
    }
    let caret = start + replacement.length
    let plainPath = Array(ancestors.dropLast()) + [UUID().uuidString + ":p"]
    replacement.append(NSAttributedString(string: "\n", attributes: [path: plainPath]))
    return QuoteExit(range: NSRange(location: start, length: end - start), replacement: replacement, caret: caret)
  }

  public static func attributedText(_ document: ComposerDocument) -> NSAttributedString {
    render(document.blocks, ancestors: [])
  }

  public static func document(_ text: NSAttributedString) -> ComposerDocument {
    let root = Node(token: "root")
    text.enumerateAttribute(path, in: NSRange(location: 0, length: text.length)) { value, range, _ in
      let tokens = value as? [String] ?? ["0:p"]
      var node = root
      for token in tokens {
        if node.children.last?.token != token {
          node.children.append(Node(token: token))
        }
        if let last = node.children.last {
          node = last
        }
      }
      let content = text.attributedSubstring(from: range)
      content.enumerateAttribute(listMarker, in: NSRange(location: 0, length: content.length)) { marker, run, _ in
        if marker as? Bool != true {
          node.text.append(content.attributedSubstring(from: run))
        }
      }
    }
    return ComposerDocument(blocks: root.children.map { $0.block() })
  }

  private static func render(_ blocks: [ComposerDocument.Block], ancestors: [String]) -> NSMutableAttributedString {
    let output = NSMutableAttributedString(string: "")
    for (index, block) in blocks.enumerated() {
      let token = "\(index):"
      switch block {
      case .blankLine:
        output.append(leaf([], ancestors: ancestors + [token + "b"]))
      case let .paragraph(content):
        output.append(leaf(content, ancestors: ancestors + [token + "p"]))
      case let .heading(content, level):
        output.append(leaf(content, ancestors: ancestors + [token + "h:\(level)"]))
      case let .code(text, language):
        output.append(leaf([.text(text)], ancestors: ancestors + [token + "c:" + language]))
      case let .quote(children):
        output.append(render(children, ancestors: ancestors + [token + "q"]))
      case let .unorderedList(items):
        output.append(renderList(items, ordered: false, ancestors: ancestors + [token + "u"]))
      case let .orderedList(items):
        output.append(renderList(items, ordered: true, ancestors: ancestors + [token + "o"]))
      }
    }
    return output
  }

  private static func renderList(_ items: [[ComposerDocument.Block]], ordered: Bool, ancestors: [String]) -> NSAttributedString {
    let output = NSMutableAttributedString(string: "")
    for (index, item) in items.enumerated() {
      let itemPath = ancestors + ["\(index):i"]
      let body = render(item, ancestors: itemPath)
      let firstPath = body.length > 0 ? body.attribute(path, at: 0, effectiveRange: nil) : itemPath + ["0:p"]
      output.append(NSAttributedString(string: ordered ? "\(index + 1).\t" : "•\t", attributes: [listMarker: true, path: firstPath ?? itemPath]))
      output.append(body)
    }
    return output
  }

  private static func leaf(_ content: [ComposerDocument.Inline], ancestors: [String]) -> NSAttributedString {
    let output = NSMutableAttributedString(attributedString: ComposerInlineText.attributedText(content))
    output.append(NSAttributedString(string: "\n"))
    output.addAttribute(path, value: ancestors, range: NSRange(location: 0, length: output.length))
    return output
  }

  private final class Node {
    let token: String
    var children: [Node] = []
    let text = NSMutableAttributedString(string: "")

    init(token: String) {
      self.token = token
    }

    func block() -> ComposerDocument.Block {
      let parts = token.split(separator: ":", maxSplits: 2, omittingEmptySubsequences: false)
      let kind = parts.count > 1 ? String(parts[1]) : "p"
      let detail = parts.count > 2 ? String(parts[2]) : ""
      let body = NSMutableAttributedString(attributedString: text)
      if body.string.hasSuffix("\n") {
        body.deleteCharacters(in: NSRange(location: body.length - 1, length: 1))
      }
      switch kind {
      case "b": return body.length == 0 ? .blankLine : .paragraph(ComposerInlineText.content(body))
      case "q": return .quote(children.map { $0.block() })
      case "u": return .unorderedList(children.map { $0.children.map { $0.block() } })
      case "o": return .orderedList(children.map { $0.children.map { $0.block() } })
      case "c": return .code(body.string, language: detail)
      case "h": return .heading(ComposerInlineText.content(body), level: Int(detail) ?? 1)
      default: return .paragraph(ComposerInlineText.content(body))
      }
    }
  }
}

import Foundation

public enum ComposerBlockFormat: String, CaseIterable, Sendable {
  case quote, unorderedList, orderedList, codeBlock

  public func isActive(in text: NSAttributedString) -> Bool {
    guard text.length > 0 else { return false }
    let kind = switch self {
    case .quote: "q"
    case .unorderedList: "u"
    case .orderedList: "o"
    case .codeBlock: "c"
    }
    var active = true
    text.enumerateAttribute(ComposerBlockText.path, in: NSRange(location: 0, length: text.length)) { value, _, stop in
      let path = value as? [String] ?? []
      if !path.contains(where: { $0.split(separator: ":").dropFirst().first == Substring(kind) }) {
        active = false
        stop.pointee = true
      }
    }
    return active
  }

  public func applying(to text: NSAttributedString) -> NSAttributedString {
    let document = ComposerBlockText.document(text)
    let blocks = document.blocks.isEmpty ? [.paragraph([])] : document.blocks
    let result: [ComposerDocument.Block] = switch self {
    case .quote:
      if blocks.count == 1, case let .quote(children) = blocks[0] {
        children
      } else {
        [.quote(blocks)]
      }
    case .unorderedList:
      if blocks.count == 1, case let .unorderedList(items) = blocks[0] {
        items.flatMap(\.self)
      } else {
        [.unorderedList(Self.paragraphs(text))]
      }
    case .orderedList:
      if blocks.count == 1, case let .orderedList(items) = blocks[0] {
        items.flatMap(\.self)
      } else {
        [.orderedList(Self.paragraphs(text))]
      }
    case .codeBlock:
      [.code(Self.withoutMarkers(text).string, language: "")]
    }
    return ComposerBlockText.attributedText(ComposerDocument(blocks: result))
  }

  private static func paragraphs(_ text: NSAttributedString) -> [[ComposerDocument.Block]] {
    guard text.length > 0 else { return [[.paragraph([])]] }
    let source = text.string as NSString
    var offset = 0
    var items: [[ComposerDocument.Block]] = []
    while offset < source.length {
      let range = source.paragraphRange(for: NSRange(location: offset, length: 0))
      let content = withoutMarkers(text.attributedSubstring(from: range))
      items.append([.paragraph(ComposerInlineText.content(content))])
      offset = NSMaxRange(range)
    }
    return items
  }

  private static func withoutMarkers(_ text: NSAttributedString) -> NSAttributedString {
    let output = NSMutableAttributedString(string: "")
    text.enumerateAttribute(ComposerBlockText.listMarker, in: NSRange(location: 0, length: text.length)) { marker, range, _ in
      if marker as? Bool != true {
        output.append(text.attributedSubstring(from: range))
      }
    }
    if output.string.hasSuffix("\n") {
      output.deleteCharacters(in: NSRange(location: output.length - 1, length: 1))
    }
    return output
  }
}

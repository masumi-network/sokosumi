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

  /// What a format control does to the editor: the range it replaces, the text that goes
  /// there and where the collapsed caret lands.
  public struct Edit {
    public let range: NSRange
    public let replacement: NSAttributedString
    public let caret: Int

    /// The caret goes to the end of the new text, before the line ending that closes it.
    init(range: NSRange, replacement: NSAttributedString) {
      self.range = range
      self.replacement = replacement
      caret = range.location + replacement.length - (replacement.string.hasSuffix("\n") ? 1 : 0)
    }
  }

  public func edit(in text: NSAttributedString, selection: NSRange) -> Edit {
    if self == .codeBlock {
      return Self.unwrappingCode(in: text, selection: selection) ?? Self.wrappingCode(in: text, selection: selection)
    }
    let range = (text.string as NSString).paragraphRange(for: selection)
    return Edit(range: range, replacement: applying(to: text.attributedSubstring(from: range)))
  }

  /// Web unwraps the block that holds the selection's anchor, whole, into plain lines, and
  /// leaves the caret at their end. A text view does not say which end of a selection was
  /// the anchor, so the start stands for it. The fence's language goes with the fence.
  private static func unwrappingCode(in text: NSAttributedString, selection: NSRange) -> Edit? {
    guard text.length > 0, selection.location <= text.length else { return nil }
    // Every block owns its line ending, so the character at the caret is on the caret's
    // line; past the last line ending the caret still types into the last block.
    let probe = min(selection.location, text.length - 1)
    let path = blockPath(in: text, at: probe)
    guard kind(path.last) == "c" else { return nil }
    var start = probe
    var end = probe + 1
    while start > 0, blockPath(in: text, at: start - 1) == path {
      start -= 1
    }
    while end < text.length, blockPath(in: text, at: end) == path {
      end += 1
    }
    // A paragraph right before the block takes the lines in, so a word wrapped out of a
    // line rejoins it, as on web.
    let before = start > 0 ? blockPath(in: text, at: start - 1) : []
    let joins = kind(before.last) == "p" && before.dropLast() == path.dropLast()
    let index = path.last?.split(separator: ":").first.map(String.init) ?? "0"
    let plain = joins ? before : Array(path.dropLast()) + [index + ":p"]
    // Only the characters leave the fence: it never sent inline formatting.
    let replacement = NSMutableAttributedString(attributedString: text.attributedSubstring(from: NSRange(location: start, length: end - start)))
    replacement.enumerateAttribute(ComposerBlockText.listMarker, in: NSRange(location: 0, length: replacement.length)) { marker, run, _ in
      var attributes: [NSAttributedString.Key: Any] = [ComposerBlockText.path: plain]
      if marker as? Bool == true {
        attributes[ComposerBlockText.listMarker] = true
      }
      replacement.setAttributes(attributes, range: run)
    }
    return Edit(range: NSRange(location: start, length: end - start), replacement: replacement)
  }

  /// Wraps the selection as flat text, or opens an empty block at a collapsed caret. The
  /// block stays inside the quote it was made in and ends the line it is on.
  private static func wrappingCode(in text: NSAttributedString, selection: NSRange) -> Edit {
    let source = text.string as NSString
    var range = selection
    // The block brings its own line ending; taking over the selection's keeps a round trip exact.
    if NSMaxRange(range) < source.length, source.character(at: NSMaxRange(range)) == 10 {
      range.length += 1
    }
    let before = range.location > 0 ? blockPath(in: text, at: range.location - 1) : []
    let after = NSMaxRange(range) < text.length ? blockPath(in: text, at: NSMaxRange(range)) : []
    let here = text.length > 0 ? blockPath(in: text, at: min(range.location, text.length - 1)) : []
    let quotes = Array(here.prefix { kind($0) == "q" })
    let path = (0...).lazy.map { quotes + ["\($0):c:"] }.first { $0 != before && $0 != after } ?? quotes + ["0:c:"]
    let replacement = NSMutableAttributedString(string: "")
    // An empty block opened inside a line would share that line; web's is a block element.
    if selection.length == 0, range.location > 0, source.character(at: range.location - 1) != 10 {
      replacement.append(NSAttributedString(string: "\n", attributes: [ComposerBlockText.path: before]))
    }
    let code = codeText(text.attributedSubstring(from: selection))
    replacement.append(NSAttributedString(string: code + "\n", attributes: [ComposerBlockText.path: path]))
    return Edit(range: range, replacement: replacement)
  }

  /// The selection as the characters it shows: list markers out, a reference chip as its label.
  private static func codeText(_ text: NSAttributedString) -> String {
    let flat = NSMutableAttributedString(attributedString: withoutMarkers(text))
    flat.enumerateAttribute(ComposerReferenceText.name, in: NSRange(location: 0, length: flat.length), options: .reverse) { name, run, _ in
      if let name = name as? String {
        flat.replaceCharacters(in: run, with: String(repeating: name, count: run.length))
      }
    }
    return flat.string
  }

  private static func blockPath(in text: NSAttributedString, at index: Int) -> [String] {
    text.attribute(ComposerBlockText.path, at: index, effectiveRange: nil) as? [String] ?? ["0:p"]
  }

  private static func kind(_ token: String?) -> Substring? {
    token?.split(separator: ":", maxSplits: 2, omittingEmptySubsequences: false).dropFirst().first
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
      [.code(Self.codeText(text), language: "")]
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

import Foundation

/// Web's Slack-style input rules: a just-typed closing `**`, `~~`, `_` or `` ` ``
/// turns the text since its opening delimiter into live formatting.
/// Ranges are UTF-16, as in native text storage.
public struct ComposerInputRule: Equatable, Sendable {
  public let style: ComposerInlineText.Style
  /// Opening delimiter through closing delimiter.
  public let range: NSRange
  /// The text between the delimiters.
  public let inner: NSRange

  public init(style: ComposerInlineText.Style, range: NSRange, inner: NSRange) {
    self.style = style
    self.range = range
    self.inner = inner
  }

  /// Web's order: the longer delimiters first.
  private static let rules: [(delimiter: String, style: ComposerInlineText.Style)] = [
    ("**", .bold), ("~~", .strikethrough), ("_", .italic), ("`", .code)
  ]

  /// `typed` is the character the keystroke inserted; pasted or programmatic
  /// text never fires a rule. `nodeStart` bounds the search like web's text node.
  public static func match(in text: String, caret: Int, typed: String, nodeStart: Int = 0) -> Self? {
    let source = text as NSString
    guard typed.utf16.count == 1, nodeStart >= 0, caret > nodeStart, caret <= source.length else { return nil }
    let node = source.substring(with: NSRange(location: nodeStart, length: caret - nodeStart)) as NSString
    for (delimiter, style) in rules where delimiter.hasSuffix(typed) {
      let width = delimiter.utf16.count
      let closeStart = node.length - width
      guard closeStart > 0, node.range(of: delimiter, options: [.backwards, .literal, .anchored]).location != NSNotFound else { continue }
      let open = node.range(of: delimiter, options: [.backwards, .literal], range: NSRange(location: 0, length: closeStart))
      guard open.location != NSNotFound else { continue }
      let inner = NSRange(location: NSMaxRange(open), length: closeStart - NSMaxRange(open))
      let content = node.substring(with: inner)
      guard inner.length > 0, !content.contains("\n"), !content.contains(delimiter),
            delimiter != "_" || !content.contains("*"),
            open.location == 0 || !isWordCharacter(node.character(at: open.location - 1)) else { continue }
      return Self(style: style,
                  range: NSRange(location: nodeStart + open.location, length: node.length - open.location),
                  inner: NSRange(location: nodeStart + inner.location, length: inner.length))
    }
    return nil
  }

  /// Bounds the search to the caret's run of uniform formatting on its line,
  /// which is what web's text node is, and skips code, code blocks and chips.
  public static func match(in text: NSAttributedString, caret: Int, typed: String) -> Self? {
    guard caret > 0, caret <= text.length else { return nil }
    let node = Node(text.attributes(at: caret - 1, effectiveRange: nil))
    guard !node.isProtected else { return nil }
    let line = (text.string as NSString).lineRange(for: NSRange(location: caret - 1, length: 0))
    var start = caret - 1
    while start > line.location, Node(text.attributes(at: start - 1, effectiveRange: nil)) == node {
      start -= 1
    }
    return match(in: text.string, caret: caret, typed: typed, nodeStart: start)
  }

  /// What replaces `range`: the inner text, formatted, without its delimiters.
  public func replacement(in text: NSAttributedString) -> NSAttributedString {
    let result = NSMutableAttributedString(attributedString: text.attributedSubstring(from: inner))
    result.addAttribute(style.attribute, value: true, range: NSRange(location: 0, length: result.length))
    return result
  }

  /// Web: `/[\p{L}\p{N}_]/u` against one UTF-16 unit, so half a surrogate pair never guards.
  private static func isWordCharacter(_ unit: unichar) -> Bool {
    guard let scalar = Unicode.Scalar(unit) else { return false }
    if scalar == "_" {
      return true
    }
    switch scalar.properties.generalCategory {
    case .uppercaseLetter, .lowercaseLetter, .titlecaseLetter, .modifierLetter, .otherLetter,
         .decimalNumber, .letterNumber, .otherNumber:
      return true
    default:
      return false
    }
  }

  /// The semantic attributes that split web's DOM into separate text nodes.
  private struct Node: Equatable {
    let styles: [Bool]
    let link: String?
    let reference: String?
    let path: [String]
    let isListMarker: Bool
    let isCode: Bool

    init(_ attributes: [NSAttributedString.Key: Any]) {
      styles = ComposerInlineText.Style.allCases.map { attributes[$0.attribute] as? Bool == true }
      link = attributes[ComposerInlineText.link] as? String
      reference = attributes[ComposerReferenceText.token] as? String
      path = attributes[ComposerBlockText.path] as? [String] ?? []
      isListMarker = attributes[ComposerBlockText.listMarker] as? Bool == true
      isCode = attributes[ComposerInlineText.code] as? Bool == true
    }

    var isProtected: Bool {
      let isCodeBlock = path.last?.split(separator: ":", maxSplits: 2, omittingEmptySubsequences: false).dropFirst().first == "c"
      return reference != nil || isListMarker || isCodeBlock || isCode
    }
  }
}

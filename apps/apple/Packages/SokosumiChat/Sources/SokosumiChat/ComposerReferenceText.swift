import Foundation

/// One replacement character per reference keeps editing atomic without platform UI types.
public enum ComposerReferenceText {
  public static let token = NSAttributedString.Key("com.sokosumi.composer.referenceToken")
  public static let name = NSAttributedString.Key("com.sokosumi.composer.referenceName")

  public static func chip(_ mention: ComposerMention, attributes: [NSAttributedString.Key: Any] = [:]) -> NSAttributedString {
    chip(token: mention.token, name: "@" + mention.name, attributes: attributes)
  }

  public static func chip(token value: String, name label: String, attributes: [NSAttributedString.Key: Any] = [:]) -> NSAttributedString {
    var attributes = attributes
    attributes[token] = value
    attributes[name] = label
    attributes.removeValue(forKey: ComposerBlockText.listMarker)
    return NSAttributedString(string: "\u{FFFC}", attributes: attributes)
  }

  public static func presenting(_ text: NSAttributedString, catalog: [ComposerMention]) -> NSAttributedString {
    guard !catalog.isEmpty,
          let expression = try? NSRegularExpression(pattern: "@([^\\s:,.!?;()\\[\\]{}]+)(?::([^\\s]+))?") else { return text }
    let output = NSMutableAttributedString(attributedString: text)
    let source = text.string as NSString
    for match in expression.matches(in: text.string, range: NSRange(location: 0, length: text.length)).reversed() {
      let id = source.substring(with: match.range(at: 1))
      guard let mention = catalog.first(where: { $0.id == id }) else { continue }
      let attributes = text.attributes(at: match.range.location, effectiveRange: nil)
      guard !isProtected(text, range: match.range) else { continue }
      // Preserve the stored slug and any punctuation rather than rewriting an existing draft.
      var values = chip(mention, attributes: attributes).attributes(at: 0, effectiveRange: nil)
      values[token] = source.substring(with: match.range)
      output.replaceCharacters(in: match.range, with: NSAttributedString(string: "\u{FFFC}", attributes: values))
    }
    return output
  }

  /// Restores channel references from semantic prose; code and existing links stay literal.
  public static func presentingChannels(_ text: NSAttributedString, channels: [ComposerChannel]) -> NSAttributedString {
    let output = NSMutableAttributedString(attributedString: text)
    let source = text.string as NSString
    for (range, _) in ComposerChannel.referenceRanges(in: text.string, channels: channels).reversed() {
      guard !isProtected(text, range: range) else { continue }
      let value = source.substring(with: range)
      output.replaceCharacters(in: range, with: chip(token: value, name: value, attributes: text.attributes(at: range.location, effectiveRange: nil)))
    }
    return output
  }

  private static func isProtected(_ text: NSAttributedString, range: NSRange) -> Bool {
    var protected = false
    text.enumerateAttributes(in: range) { attributes, _, stop in
      let path = attributes[ComposerBlockText.path] as? [String] ?? []
      if attributes[ComposerInlineText.code] as? Bool == true || attributes[ComposerInlineText.link] != nil
        || attributes[token] != nil || path.contains(where: { $0.split(separator: ":", maxSplits: 2).dropFirst().first == "c" }) {
        protected = true
        stop.pointee = true
      }
    }
    return protected
  }
}

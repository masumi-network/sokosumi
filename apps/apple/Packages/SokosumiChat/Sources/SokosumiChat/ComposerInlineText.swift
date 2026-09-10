import Foundation

/// Semantic attributes carried by native text storage; never inferred from font appearance.
public enum ComposerInlineText {
  public enum Style: String, CaseIterable, Sendable {
    case bold, italic, underline, strikethrough, code

    public var attribute: NSAttributedString.Key {
      NSAttributedString.Key("com.sokosumi.composer." + rawValue)
    }
  }

  public static func isActive(_ style: Style, in text: NSAttributedString) -> Bool {
    guard text.length > 0 else { return false }
    var active = true
    var sawContent = false
    text.enumerateAttributes(in: NSRange(location: 0, length: text.length)) { values, _, _ in
      if values[ComposerBlockText.listMarker] as? Bool == true {
        return
      }
      sawContent = true
      if values[style.attribute] as? Bool != true {
        active = false
      }
    }
    return sawContent && active
  }

  public static func toggling(_ style: Style, in text: NSAttributedString) -> NSAttributedString {
    let result = NSMutableAttributedString(attributedString: text)
    let shouldRemove = isActive(style, in: text)
    result.enumerateAttribute(ComposerBlockText.listMarker, in: NSRange(location: 0, length: result.length)) { marker, range, _ in
      if marker as? Bool == true {
        return
      }
      if shouldRemove {
        result.removeAttribute(style.attribute, range: range)
      } else {
        result.addAttribute(style.attribute, value: true, range: range)
      }
    }
    return result
  }

  public static let bold = NSAttributedString.Key("com.sokosumi.composer.bold")
  public static let italic = NSAttributedString.Key("com.sokosumi.composer.italic")
  public static let underline = NSAttributedString.Key("com.sokosumi.composer.underline")
  public static let strikethrough = NSAttributedString.Key("com.sokosumi.composer.strikethrough")
  public static let code = NSAttributedString.Key("com.sokosumi.composer.code")
  public static let link = NSAttributedString.Key("com.sokosumi.composer.link")

  public static func attributedText(_ children: [ComposerDocument.Inline]) -> NSAttributedString {
    let output = NSMutableAttributedString(string: "")
    for child in children {
      switch child {
      case let .text(text): output.append(NSAttributedString(string: text))
      case let .bold(nested): output.append(mark(nested, key: bold))
      case let .italic(nested): output.append(mark(nested, key: italic))
      case let .underline(nested): output.append(mark(nested, key: underline))
      case let .strikethrough(nested): output.append(mark(nested, key: strikethrough))
      case let .code(text): output.append(NSAttributedString(string: text, attributes: [code: true]))
      case let .link(nested, destination): output.append(mark(nested, key: link, value: destination))
      }
    }
    return output
  }

  public static func content(_ text: NSAttributedString) -> [ComposerDocument.Inline] {
    decode(text, range: NSRange(location: 0, length: text.length), level: 0)
  }

  private static func mark(_ children: [ComposerDocument.Inline], key: NSAttributedString.Key, value: Any = true) -> NSAttributedString {
    let text = NSMutableAttributedString(attributedString: attributedText(children))
    text.addAttribute(key, value: value, range: NSRange(location: 0, length: text.length))
    return text
  }

  private static func decode(_ text: NSAttributedString, range: NSRange, level: Int) -> [ComposerDocument.Inline] {
    guard range.length > 0 else { return [] }
    let keys = [code, link, bold, italic, underline, strikethrough]
    guard level < keys.count else { return [.text((text.string as NSString).substring(with: range))] }
    let key = keys[level]
    var output: [ComposerDocument.Inline] = []
    text.enumerateAttribute(key, in: range) { value, run, _ in
      if key == code, value as? Bool == true {
        output.append(.code((text.string as NSString).substring(with: run)))
        return
      }
      let nested = decode(text, range: run, level: level + 1)
      switch key {
      case link where value is String:
        output.append(.link(nested, destination: value as? String ?? ""))
      case bold where value as? Bool == true: output.append(.bold(nested))
      case italic where value as? Bool == true: output.append(.italic(nested))
      case underline where value as? Bool == true: output.append(.underline(nested))
      case strikethrough where value as? Bool == true: output.append(.strikethrough(nested))
      default: output.append(contentsOf: nested)
      }
    }
    return output
  }
}

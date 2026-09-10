import Foundation

/// A portable marker translated to SwiftUI's underline attribute by the view.
public enum MessageUnderlineAttribute: AttributedStringKey {
  public typealias Value = Bool
  public static let name = "sokosumi.message.underline"
}

/// Foundation already distinguishes inline HTML from escaped tags and code.
/// Interpret only formatting tags here; block HTML requires separate handling.
enum MessageInlineHTML {
  static func applying(to parsed: AttributedString) -> AttributedString {
    var result = AttributedString()
    var openTags: [String] = []
    for run in parsed.runs {
      var text = AttributedString(parsed[run.range])
      if run.inlinePresentationIntent?.contains(.inlineHTML) == true,
         let tag = formattingTag(String(text.characters)) {
        if tag.name == "br" {
          text = AttributedString("\n", attributes: run.attributes)
          text.inlinePresentationIntent = nil
        } else {
          if tag.closing {
            if let index = openTags.lastIndex(of: tag.name) {
              openTags.remove(at: index)
            }
          } else {
            openTags.append(tag.name)
          }
          continue
        }
      }
      var intent = text.inlinePresentationIntent ?? []
      if openTags.contains("b") || openTags.contains("strong") {
        intent.insert(.stronglyEmphasized)
      }
      if openTags.contains("i") || openTags.contains("em") {
        intent.insert(.emphasized)
      }
      if !intent.isEmpty {
        text.inlinePresentationIntent = intent
      }
      if openTags.contains("u") {
        text[MessageUnderlineAttribute.self] = true
      }
      result.append(text)
    }
    return result
  }

  private static func formattingTag(_ raw: String) -> (name: String, closing: Bool)? {
    guard raw.hasPrefix("<"), raw.hasSuffix(">") else { return nil }
    let closing = raw.hasPrefix("</")
    let body = raw.dropFirst(closing ? 2 : 1)
    let name = body.prefix { $0.isASCII && $0.isLetter }.lowercased()
    guard ["b", "strong", "i", "em", "u", "br"].contains(name),
          let boundary = body.dropFirst(name.count).first,
          boundary.isWhitespace || boundary == ">" || boundary == "/"
    else { return nil }
    return (name, closing)
  }
}

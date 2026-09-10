import Foundation
import SwiftSoup

/// The HTML allowlist used by web's sanitizeMarkdown, independent of presentation.
enum MessageHTML {
  /// micromark’s default link schemes, applied after HTML sanitization.
  static let linkSchemes: Set<String> = ["http", "https", "mailto", "irc", "ircs", "xmpp"]

  private static let allowedTags: Set<String> = [
    "b", "i", "em", "strong", "a", "source", "p", "h1", "h2", "h3",
    "ul", "ol", "li", "br", "img", "video", "audio", "code", "mark", "span", "u"
  ]
  private static let discardedContent: Set<String> = ["script", "style", "textarea", "option"]
  private static let attributes: [String: Set<String>] = [
    "a": ["href"],
    "img": ["src", "alt", "title", "width", "height"],
    "video": ["src", "controls", "loop", "muted", "width", "height"],
    "audio": ["src", "controls", "loop", "muted", "width", "height"],
    "source": ["src"],
    "mark": ["class"],
    "span": ["class", "data-direct-kind", "data-direct-id"]
  ]
  private static let classes: [String: Set<String>] = [
    "mark": ["bg-primary/50", "text-foreground", "rounded-sm", "px-0.5"],
    "span": ["text-primary", "font-medium", "whitespace-nowrap"]
  ]

  static func parse(_ source: String) throws -> Element {
    let document = try SwiftSoup.parseBodyFragment(source)
    document.outputSettings().prettyPrint(pretty: false)
    guard let body = document.body() else {
      throw CocoaError(.coderReadCorrupt)
    }
    try cleanChildren(of: body)
    return body
  }

  private static func cleanChildren(of parent: Node) throws {
    for child in parent.getChildNodes() {
      guard let element = child as? Element else {
        if !(child is TextNode) {
          try child.remove()
        }
        continue
      }
      let tag = element.tagName()
      if discardedContent.contains(tag) {
        try element.remove()
        continue
      }
      try cleanChildren(of: element)
      guard allowedTags.contains(tag) else {
        try element.unwrap()
        continue
      }
      try cleanAttributes(of: element, tag: tag)
    }
  }

  private static func cleanAttributes(of element: Element, tag: String) throws {
    for attribute in element.getAttributes()?.asList() ?? [] {
      let key = attribute.getKey()
      let value = attribute.getValue()
      guard attributes[tag]?.contains(key) == true else {
        try element.removeAttr(key)
        continue
      }
      if ["href", "src"].contains(key), !safeURL(value) {
        try element.removeAttr(key)
      } else if key == "class" {
        let kept = value.split(whereSeparator: \.isWhitespace).filter { classes[tag]?.contains(String($0)) == true }
        if kept.isEmpty {
          try element.removeAttr(key)
        } else {
          try element.attr(key, kept.joined(separator: " "))
        }
      }
    }
  }

  private static func safeURL(_ source: String) -> Bool {
    // HTML entities are decoded by SwiftSoup; browsers ignore ASCII controls in schemes.
    let value = source.unicodeScalars.filter { $0.value > 32 && $0.value != 127 }.map(String.init).joined()
    guard let colon = value.firstIndex(of: ":") else { return true }
    let prefix = value[..<colon]
    guard !prefix.contains("/"), !prefix.contains("?"), !prefix.contains("#") else { return true }
    return ["http", "https", "ftp", "mailto", "tel"].contains(prefix.lowercased())
  }
}

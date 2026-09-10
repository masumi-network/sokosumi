import Foundation
import SwiftSoup

/// A portable marker translated to SwiftUI's underline attribute by the view.
public enum MessageUnderlineAttribute: AttributedStringKey {
  public typealias Value = Bool
  public static let name = "sokosumi.message.underline"
}

enum MessageHTMLTokenAttribute: AttributedStringKey {
  typealias Value = Int
  static let name = "sokosumi.message.htmlToken"
}

enum MessageInlineHTML {
  static func applying(to parsed: AttributedString, baseURL: URL? = nil) -> AttributedString {
    guard parsed.runs.contains(where: { $0.inlinePresentationIntent?.contains(.inlineHTML) == true }) else {
      return parsed
    }
    // Keep native Markdown runs out of HTML parsing, including escaped tags/code.
    // A per-parse marker prevents message content from impersonating these runs.
    let prefix = "SOKO" + UUID().uuidString.replacingOccurrences(of: "-", with: "") + "TEXT"
    var values: [String: AttributedString] = [:]
    var html = ""
    for run in parsed.runs {
      if run.inlinePresentationIntent?.contains(.inlineHTML) == true {
        html += String(parsed[run.range].characters)
      } else {
        let token = prefix + String(values.count) + "END"
        values[token] = AttributedString(parsed[run.range])
        html += token
      }
    }
    guard let body = try? MessageHTML.parse(html) else { return parsed }
    return render(body, baseURL: baseURL) { text in
      restore(text, prefix: prefix, values: values)
    }
  }

  static func render(
    _ node: Node,
    baseURL: URL?,
    text: (String) -> AttributedString = { AttributedString($0) }
  ) -> AttributedString {
    if let node = node as? TextNode {
      return text(node.getWholeText())
    }
    guard let element = node as? Element else { return AttributedString() }
    if element.tagName() == "br" {
      return AttributedString("\n")
    }
    var result = element.getChildNodes().reduce(into: AttributedString()) {
      $0.append(render($1, baseURL: baseURL, text: text))
    }
    if element.tagName() == "img" {
      let label = (try? element.attr("alt")) ?? ""
      result = AttributedString(label.isEmpty ? ((try? element.attr("src")) ?? "") : label)
    }
    let intent = inlineIntent(element.tagName())
    if !intent.isEmpty {
      for run in result.runs {
        result[run.range].inlinePresentationIntent = (run.inlinePresentationIntent ?? []).union(intent)
      }
    }
    if element.tagName() == "u" {
      result[MessageUnderlineAttribute.self] = true
    }
    if let url = linkURL(element, baseURL: baseURL) {
      result.link = url
    }
    return result
  }

  private static func inlineIntent(_ tag: String) -> InlinePresentationIntent {
    switch tag {
    case "b", "strong": .stronglyEmphasized
    case "i", "em": .emphasized
    case "code": .code
    default: []
    }
  }

  private static func linkURL(_ element: Element, baseURL: URL?) -> URL? {
    let attribute: String
    switch element.tagName() {
    case "a": attribute = "href"
    case "img": attribute = "src"
    default: return nil
    }
    guard let href = try? element.attr(attribute), !href.isEmpty,
          let url = URL(string: href, relativeTo: baseURL)?.absoluteURL,
          url.scheme == nil || ["http", "https", "mailto", "irc", "ircs", "xmpp"].contains(url.scheme?.lowercased() ?? "")
    else { return nil }
    return url
  }

  private static func restore(
    _ source: String,
    prefix: String,
    values: [String: AttributedString]
  ) -> AttributedString {
    var result = AttributedString()
    var remaining = source[...]
    while let start = remaining.range(of: prefix),
          let end = remaining[start.upperBound...].range(of: "END") {
      result.append(AttributedString(remaining[..<start.lowerBound]))
      let token = String(remaining[start.lowerBound ..< end.upperBound])
      result.append(values[token] ?? AttributedString(token))
      remaining = remaining[end.upperBound...]
    }
    result.append(AttributedString(remaining))
    return result
  }
}

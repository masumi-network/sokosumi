import Foundation
import SwiftSoup

public enum ComposerPaste {
  public static func plainText(html: String) -> String {
    guard let body = try? SwiftSoup.parse(html).body() else { return "" }
    return text(body)
      .replacingOccurrences(of: "\u{00A0}", with: " ")
      .replacingOccurrences(of: "\r\n", with: "\n")
      .replacingOccurrences(of: "\n{3,}", with: "\n\n", options: .regularExpression)
  }

  private static func text(_ node: Node) -> String {
    if let text = node as? TextNode {
      return text.getWholeText()
    }
    if let data = node as? DataNode {
      return data.getWholeData()
    }
    let tag = (node as? Element)?.tagName()
    if tag == "br" {
      return "\n"
    }
    let content = node.getChildNodes().map(text).joined()
    let blocks: Set = ["p", "div", "li", "blockquote", "pre", "h1", "h2", "h3", "h4", "h5", "h6", "tr", "table", "ul", "ol"]
    return content + (tag.map { blocks.contains($0) } == true ? "\n" : "")
  }
}

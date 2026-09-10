import Foundation
import Markdown
import SwiftSoup

/// UI-free document blocks with inline attributes for native text rendering.
public struct MessageMarkdownBlock: Identifiable, Equatable, Sendable {
  public let id: Int
  public let kind: PresentationIntent.Kind
  public fileprivate(set) var text = AttributedString()
  public fileprivate(set) var children: [MessageMarkdownBlock] = []
  public fileprivate(set) var taskChecked: Bool?
}

public struct MessageMarkdown: Equatable, Sendable {
  public let blocks: [MessageMarkdownBlock]

  public init(_ source: String, baseURL: URL? = nil) {
    let normalized = source.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
    let document = Markdown.Document(parsing: MarkdownBareDomains(MessageMarkdownNormalization.applying(to: normalized)).linkified())
    var builder = MarkdownBlockBuilder(baseURL: baseURL)
    blocks = document.children.flatMap { builder.blocks(for: $0) }
  }
}

private struct MarkdownBlockBuilder {
  let baseURL: URL?
  var nextID = 0

  mutating func blocks(for node: any Markup) -> [MessageMarkdownBlock] {
    if let html = node as? HTMLBlock, let body = try? MessageHTML.parse(html.rawHTML) {
      return htmlBlocks(body.getChildNodes())
    }
    return [block(node)]
  }

  private mutating func htmlBlocks(_ nodes: [Node]) -> [MessageMarkdownBlock] {
    var result: [MessageMarkdownBlock] = []
    var pending = AttributedString()
    for node in nodes {
      if let element = node as? Element,
         ["p", "h1", "h2", "h3", "ul", "ol", "li"].contains(element.tagName()) {
        appendHTMLParagraph(pending, to: &result)
        pending = AttributedString()
        result.append(htmlBlock(element))
      } else {
        pending.append(MessageInlineHTML.render(node, baseURL: baseURL))
      }
    }
    appendHTMLParagraph(pending, to: &result)
    return result
  }

  private mutating func appendHTMLParagraph(_ text: AttributedString, to blocks: inout [MessageMarkdownBlock]) {
    guard !String(text.characters).trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
    nextID += 1
    var paragraph = MessageMarkdownBlock(id: nextID, kind: .paragraph)
    paragraph.text = text
    blocks.append(paragraph)
  }

  private mutating func htmlBlock(_ element: Element, ordinal: Int = 1) -> MessageMarkdownBlock {
    let tag = element.tagName()
    let kind: PresentationIntent.Kind = switch tag {
    case "h1": .header(level: 1)
    case "h2": .header(level: 2)
    case "h3": .header(level: 3)
    case "ul": .unorderedList
    case "ol": .orderedList
    case "li": .listItem(ordinal: ordinal)
    default: .paragraph
    }
    nextID += 1
    var result = MessageMarkdownBlock(id: nextID, kind: kind)
    if tag == "ul" || tag == "ol" {
      result.children = element.getChildNodes().compactMap { $0 as? Element }
        .filter { $0.tagName() == "li" }.enumerated().map { index, item in
          htmlBlock(item, ordinal: index + 1)
        }
    } else if tag == "li" {
      result.children = htmlBlocks(element.getChildNodes())
    } else {
      result.text = MessageInlineHTML.render(element, baseURL: baseURL)
    }
    return result
  }

  mutating func block(_ node: any Markup, kind override: PresentationIntent.Kind? = nil) -> MessageMarkdownBlock {
    nextID += 1
    var result = MessageMarkdownBlock(id: nextID, kind: override ?? kind(node))
    if let code = node as? CodeBlock {
      result.text = AttributedString(code.code)
    } else if let table = node as? Markdown.Table {
      result.children = [block(table.head, kind: .tableHeaderRow)]
      result.children += table.body.children.enumerated().map { index, row in
        block(row, kind: .tableRow(rowIndex: index + 1))
      }
    } else if node is Markdown.Table.Head || node is Markdown.Table.Row {
      result.children = node.children.enumerated().map { index, cell in
        block(cell, kind: .tableCell(columnIndex: index))
      }
    } else if node is OrderedList || node is UnorderedList {
      let start = Int((node as? OrderedList)?.startIndex ?? 1)
      result.children = node.children.enumerated().map { index, item in
        block(item, kind: .listItem(ordinal: start + index))
      }
    } else if node is ListItem || node is BlockQuote {
      result.children = node.children.flatMap { blocks(for: $0) }
      if let checkbox = (node as? ListItem)?.checkbox {
        result.taskChecked = checkbox == .checked
      }
    } else {
      result.text = MessageInlineHTML.applying(to: inline(node), baseURL: baseURL)
    }
    return result
  }

  private func kind(_ node: any Markup) -> PresentationIntent.Kind {
    switch node {
    case let heading as Heading: .header(level: heading.level)
    case let code as CodeBlock: .codeBlock(languageHint: code.language)
    case is OrderedList: .orderedList
    case is UnorderedList: .unorderedList
    case is BlockQuote: .blockQuote
    case is ThematicBreak: .thematicBreak
    case let table as Markdown.Table:
      .table(columns: table.columnAlignments.map { .init(alignment: alignment($0)) })
    default: .paragraph
    }
  }

  private func alignment(_ value: Markdown.Table.ColumnAlignment?) -> PresentationIntent.TableColumn.Alignment {
    switch value {
    case .center: .center
    case .right: .right
    default: .left
    }
  }

  private func inline(_ node: any Markup) -> AttributedString {
    if let text = node as? Markdown.Text {
      return AttributedString(MessageEmoji.replacing(in: text.string))
    }
    if node is SoftBreak || node is LineBreak {
      return AttributedString("\n")
    }
    if let html = node as? InlineHTML {
      var text = AttributedString(html.rawHTML)
      text.inlinePresentationIntent = .inlineHTML
      text[MessageHTMLTokenAttribute.self] = node.indexInParent
      return text
    }
    if let html = node as? HTMLBlock {
      return AttributedString(html.rawHTML)
    }
    if let code = node as? InlineCode {
      var text = AttributedString(code.code)
      text.inlinePresentationIntent = .code
      return text
    }
    var result = node.children.reduce(into: AttributedString()) { $0.append(inline($1)) }
    let intent = inlineIntent(node)
    if !intent.isEmpty {
      for run in result.runs {
        result[run.range].inlinePresentationIntent = (run.inlinePresentationIntent ?? []).union(intent)
      }
    }
    if let link = node as? Markdown.Link, let destination = link.destination,
       let url = URL(string: destination, relativeTo: baseURL)?.absoluteURL,
       url.scheme == nil || ["http", "https", "mailto", "irc", "ircs", "xmpp"].contains(url.scheme?.lowercased() ?? "") {
      result.link = url
    }
    return result
  }

  private func inlineIntent(_ node: any Markup) -> InlinePresentationIntent {
    switch node {
    case is Strong: .stronglyEmphasized
    case is Emphasis: .emphasized
    case is Strikethrough: .strikethrough
    default: []
    }
  }
}

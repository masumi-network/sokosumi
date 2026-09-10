import Foundation

/// A UI-free tree of Foundation's Markdown presentation intents. Container nodes
/// hold children; leaf nodes retain inline attributes for native text rendering.
public struct MessageMarkdownBlock: Identifiable, Equatable, Sendable {
  public let id: Int
  public let kind: PresentationIntent.Kind
  public private(set) var text = AttributedString()
  public private(set) var children: [MessageMarkdownBlock] = []
  public private(set) var taskChecked: Bool?

  fileprivate mutating func recognizeTasks(lines: [String]) {
    for index in children.indices {
      children[index].recognizeTasks(lines: lines)
    }
    guard case .listItem = kind,
          children.first?.kind == .paragraph,
          let run = children[0].text.runs.first,
          run.inlinePresentationIntent == nil,
          run.link == nil,
          let position = run.markdownSourcePosition,
          lines.indices.contains(position.startLine - 1)
    else { return }
    let source = lines[position.startLine - 1].utf8.dropFirst(position.startColumn - 1)
    guard let marker = String(bytes: source.prefix(3), encoding: .utf8),
          ["[ ]", "[x]", "[X]"].contains(marker),
          let separator = source.dropFirst(3).first,
          separator == 32 || separator == 9
    else { return }
    let prefix = String(children[0].text.characters.prefix(4))
    guard prefix.hasPrefix(marker), prefix.count == 4 else { return }
    taskChecked = marker != "[ ]"
    let end = children[0].text.characters.index(children[0].text.startIndex, offsetBy: 4)
    children[0].text.removeSubrange(children[0].text.startIndex ..< end)
  }

  fileprivate mutating func append(
    _ text: AttributedString,
    path: ArraySlice<PresentationIntent.IntentType>
  ) {
    guard let component = path.first else {
      self.text.append(text)
      return
    }
    // Foundation emits each block contiguously, including nested containers.
    if children.last?.id != component.identity {
      children.append(MessageMarkdownBlock(id: component.identity, kind: component.kind))
    }
    children[children.count - 1].append(text, path: path.dropFirst())
  }
}

public struct MessageMarkdown: Equatable, Sendable {
  public let blocks: [MessageMarkdownBlock]

  public init(_ source: String) {
    let source = source.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
    let parsed: AttributedString
    do {
      parsed = try AttributedString(
        markdown: source,
        options: .init(interpretedSyntax: .full, failurePolicy: .returnPartiallyParsedIfPossible, appliesSourcePositionAttributes: true)
      )
    } catch {
      parsed = AttributedString(source)
    }
    var root = MessageMarkdownBlock(id: 0, kind: .paragraph)
    for run in parsed.runs {
      var text = AttributedString(parsed[run.range])
      let intent = run.inlinePresentationIntent ?? []
      if intent.contains(.softBreak) {
        text = AttributedString("\n", attributes: run.attributes)
      }
      // SwiftUI receives inline attributes only; block layout belongs to the
      // surrounding view. Never allow a message link to launch a local URL scheme.
      text.presentationIntent = nil
      if let url = text.link, !Self.isSafeLink(url) {
        text.link = nil
      }
      let path = run.presentationIntent?.components.reversed().map(\.self)
        ?? PresentationIntent(.paragraph, identity: -1).components
      root.append(text, path: path[...])
    }
    root.recognizeTasks(lines: source.components(separatedBy: "\n"))
    blocks = root.children
  }

  private static func isSafeLink(_ url: URL) -> Bool {
    guard let scheme = url.scheme else { return true }
    return ["http", "https", "mailto", "irc", "ircs", "xmpp"].contains(scheme.lowercased())
  }
}

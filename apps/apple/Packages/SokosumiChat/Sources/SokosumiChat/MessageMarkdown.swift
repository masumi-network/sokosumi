import Foundation

/// A UI-free tree of Foundation's Markdown presentation intents. Container nodes
/// hold children; leaf nodes retain inline attributes for native text rendering.
public struct MessageMarkdownBlock: Identifiable, Equatable, Sendable {
  public let id: Int
  public let kind: PresentationIntent.Kind
  public private(set) var text = AttributedString()
  public private(set) var children: [MessageMarkdownBlock] = []

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
    let parsed: AttributedString
    do {
      parsed = try AttributedString(
        markdown: source,
        options: .init(interpretedSyntax: .full, failurePolicy: .returnPartiallyParsedIfPossible)
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
    blocks = root.children
  }

  private static func isSafeLink(_ url: URL) -> Bool {
    guard let scheme = url.scheme else { return true }
    return ["http", "https", "mailto", "irc", "ircs", "xmpp"].contains(scheme.lowercased())
  }
}

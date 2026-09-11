import CoreAPI
import SokosumiChat
import SwiftUI

/// Shared presentation for the composer preview and a persisted quote snapshot.
struct MessageQuoteView: View {
  let quote: Components.Schemas.ChatRoomMessageQuote
  var room: Components.Schemas.ChatRoom?
  var channels: [ComposerChannel] = []
  var dismiss: (() -> Void)?
  var jump: ((String) -> Void)?

  @State private var renderedSnippet = AttributedString()

  var body: some View {
    HStack(alignment: .top, spacing: 8) {
      Image(systemName: "quote.opening").foregroundStyle(.secondary)
      VStack(alignment: .leading, spacing: 4) {
        if let jump {
          Button(quote.authorName) { jump(quote.messageId) }
            .buttonStyle(.plain)
            .help("Go to quoted message")
        } else {
          Text(quote.authorName)
        }
        if !quote.snippet.isEmpty {
          ExpandableMessageBody(source: quote.snippet, collapsedLines: 4, measurementFont: .callout) {
            Text(renderedSnippet.characters.isEmpty ? AttributedString(quote.snippet) : renderedSnippet).font(.callout).textSelection(.enabled)
          }
        }
        if let attachment = quote.attachment {
          HStack {
            if attachment.mediaKind == .image, let url = URL(string: attachment.url),
               ["https", "http"].contains(url.scheme?.lowercased() ?? "") {
              AsyncImage(url: url) { image in image.resizable().scaledToFit() } placeholder: {
                Image(systemName: "photo")
              }
              .frame(width: 48, height: 48)
            } else {
              Image(systemName: "doc")
            }
            Text(attachment.fileName).lineLimit(1)
          }
          .font(.caption).foregroundStyle(.secondary)
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      if let dismiss {
        Button("Remove quote", systemImage: "xmark", action: dismiss)
          .labelStyle(.iconOnly).buttonStyle(.plain).foregroundStyle(.secondary)
      }
    }
    .padding(8)
    .background(.quaternary, in: .rect(cornerRadius: 6))
    .accessibilityElement(children: .contain)
    .task(id: quote.snippet + (room?.id ?? "")) {
      let source = quote.snippet
      let mentions = room.map(MessageMentions.init)
      let channels = channels
      let text = await Task.detached(priority: .userInitiated) {
        let document = MessageMarkdown(source, mentions: mentions, channels: channels)
        func flatten(_ blocks: [MessageMarkdownBlock]) -> AttributedString {
          var result = AttributedString()
          for block in blocks {
            if !result.characters.isEmpty {
              result.append(AttributedString("\n"))
            }
            result.append(block.text)
            result.append(flatten(block.children))
          }
          return result
        }
        return flatten(document.blocks)
      }.value
      guard !Task.isCancelled else { return }
      renderedSnippet = text
      renderedSnippet.link = nil
    }
  }
}

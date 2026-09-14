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

  private struct RenderInput: Hashable {
    let source: String
    let mentions: MessageMentions?
    let channels: [ComposerChannel]
  }

  @ScaledMetric(relativeTo: .callout) private var thumbnailSize = 48.0
  @State private var renderedSnippet = AttributedString()

  var body: some View {
    HStack(alignment: .top, spacing: 8) {
      Image(systemName: "quote.opening").foregroundStyle(.secondary).accessibilityHidden(true)
      VStack(alignment: .leading, spacing: 4) {
        if let jump {
          Button(quote.authorName) { jump(quote.messageId) }
            .buttonStyle(.plain)
            .help("Go to quoted message")
            .accessibilityLabel("Go to message quoted from \(quote.authorName)")
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
              QuoteImageThumbnail(url: url, size: thumbnailSize)
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
    .task(id: RenderInput(source: quote.snippet, mentions: room.map(MessageMentions.init), channels: channels)) {
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

private struct QuoteImageThumbnail: View {
  let url: URL
  let size: CGFloat
  @Environment(\.displayScale) private var displayScale
  @State private var image: CGImage?

  var body: some View {
    Group {
      if let image {
        Image(decorative: image, scale: displayScale).resizable().scaledToFit()
      } else {
        Image(systemName: "photo")
      }
    }
    .frame(width: size, height: size)
    .accessibilityHidden(true)
    .task(id: "\(url)-\(size)-\(displayScale)") {
      image = nil
      let loaded = await loadThumbnailCGImage(urlString: url.absoluteString, pointSize: size, scale: displayScale)
      guard !Task.isCancelled else { return }
      image = loaded
    }
  }
}

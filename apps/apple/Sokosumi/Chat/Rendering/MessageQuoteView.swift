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
  /// The composer's preview: a tile opens its file, as web's `FileChipMiniPreview` does.
  var opensAttachments = false

  private struct RenderInput: Hashable {
    let source: String
    let mentions: MessageMentions?
    let channels: [ComposerChannel]
  }

  @ScaledMetric(relativeTo: .callout) private var thumbnailSize = 40.0
  @State private var renderedSnippet = AttributedString()

  var body: some View {
    MessageQuoteBlock {
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
          ExpandableMessageBody(source: quote.snippet, collapsedLines: 4, measurementFont: .callout, fadesCut: false, titles: ("More", "Less")) {
            Text(renderedSnippet.characters.isEmpty ? AttributedString(quote.snippet) : renderedSnippet).font(.callout).textSelection(.enabled)
          }
        }
        if let attachments = quote.attachments, !attachments.isEmpty {
          WrappingRow(spacing: 4) {
            ForEach(attachments, id: \.url) {
              QuoteAttachmentThumbnail(attachment: $0, size: thumbnailSize, click: click(on: $0))
            }
          }
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      if let dismiss {
        Button("Remove quote", systemImage: "xmark", action: dismiss)
          .labelStyle(.iconOnly).buttonStyle(.plain).foregroundStyle(.secondary)
      }
    }
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

  private func click(on attachment: Components.Schemas.ChatRoomMessageQuoteAttachment) -> QuoteAttachmentThumbnail.Click {
    if let jump {
      return .jump { jump(quote.messageId) }
    }
    if opensAttachments, let preview = attachment.preview {
      return .open(preview)
    }
    return .none
  }
}

/// The inset block every quote sits in: the transcript card, the composer preview and a quote-only pin.
struct MessageQuoteBlock<Content: View>: View {
  @ViewBuilder let content: Content

  var body: some View {
    HStack(alignment: .top, spacing: 8) {
      Image(systemName: "quote.opening").foregroundStyle(.secondary).accessibilityHidden(true)
      content
    }
    .padding(8)
    .background(.quaternary, in: .rect(cornerRadius: 6))
  }
}

/// One tile of a quote's row, like web's `MessageQuoteAttachmentThumb`: an image crops to the square, a file shows its
/// type. The tile has no room for the name, so it hovers and reads aloud.
private struct QuoteAttachmentThumbnail: View {
  /// What a click does. It follows the quote's jump, as web's tile inside the jump button does, or opens the file.
  enum Click {
    case jump(() -> Void)
    case open(MessageAttachment)
    case none
  }

  let attachment: Components.Schemas.ChatRoomMessageQuoteAttachment
  let size: CGFloat
  let click: Click

  private var url: URL? {
    URL(string: attachment.url)
  }

  var body: some View {
    Group {
      switch click {
      case let .jump(jump):
        Button(action: jump) { tile }
          .buttonStyle(.plain)
      case let .open(preview):
        QuoteAttachmentOpenButton(attachment: preview) { tile }
          .messageImageGallery(MessageImageGallery([preview]))
      case .none:
        tile
      }
    }
    .help(attachment.fileName)
    .accessibilityLabel(attachment.fileName)
    // After `help`, which VoiceOver would otherwise read as the hint.
    .accessibilityHint(hint)
  }

  private var hint: LocalizedStringKey {
    switch click {
    case .jump: "Go to quoted message"
    case let .open(preview): preview.opening == .link ? "Open in Browser" : "Preview"
    case .none: ""
    }
  }

  private var tile: some View {
    Group {
      if attachment.mediaKind == .image, let url, ["https", "http"].contains(url.scheme?.lowercased() ?? "") {
        QuoteImageThumbnail(url: url, size: size)
      } else {
        AttachmentFileIcon(filename: attachment.fileName, url: url, size: size * 0.6)
      }
    }
    .frame(width: size, height: size)
    .clipShape(.rect(cornerRadius: 12))
    .overlay { RoundedRectangle(cornerRadius: 12).strokeBorder(.separator) }
    .contentShape(.rect(cornerRadius: 12))
    .accessibilityElement(children: .ignore)
  }
}

/// A composer tile's click, like web's `FileChipMiniPreview`.
private struct QuoteAttachmentOpenButton<Label: View>: View {
  let attachment: MessageAttachment
  @ViewBuilder let label: Label
  @Environment(MessageImageViewerPresentation.self) private var imageViewer: MessageImageViewerPresentation?
  @Environment(\.openURL) private var openURL
  @State private var documentPresented = false

  var body: some View {
    Button {
      switch attachment.opening {
      case .imageViewer: imageViewer?.openURL = attachment.url
      case .documentViewer: documentPresented = true
      case .link: openURL(attachment.url)
      }
    } label: {
      label
    }
    .buttonStyle(.plain)
    .sheet(isPresented: $documentPresented) {
      AttachmentDocumentSheet(attachment: attachment) { documentPresented = false }
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
        Image(decorative: image, scale: displayScale).resizable().scaledToFill()
      } else {
        Image(systemName: "photo")
      }
    }
    .frame(width: size, height: size)
    .clipped()
    .accessibilityHidden(true)
    .task(id: "\(url)-\(size)-\(displayScale)") {
      image = nil
      // The thumbnail fits its longest side; twice the tile keeps a wide image's cropped short side sharp.
      let loaded = await loadImageThumbnail(urlString: url.absoluteString, pointSize: size * 2, scale: displayScale)
      guard !Task.isCancelled else { return }
      image = loaded?.cgImage
    }
  }
}

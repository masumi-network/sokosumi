import CoreAPI
import Foundation

/// Local preview only. Core builds the authoritative snapshot from the source ID.
public func messageQuote(from message: Components.Schemas.ChatRoomMessage) -> Components.Schemas.ChatRoomMessageQuote? {
  guard canQuoteMessage(message) else { return nil }
  func paragraphs(_ blocks: [MessageMarkdownBlock]) -> [[MessageAttachmentSegment]] {
    blocks.flatMap { [MessageAttachmentSegment.split($0.text)] + paragraphs($0.children) }
  }
  let content = message.content.replacingOccurrences(of: #"```[\s\S]*?```"#, with: " ", options: .regularExpression)
  let parts = paragraphs(MessageMarkdown(content).blocks)
  let attachments = parts.flatMap { $0.compactMap(\.attachment) }
  let attachment = attachments.first { $0.kind == .image } ?? attachments.first
  var removedAttachment = false
  let snippet = parts.map { paragraph in
    paragraph.map { part in
      if let attachment, part.attachment == attachment, !removedAttachment {
        removedAttachment = true
        return ""
      }
      return String(part.text.characters)
    }.joined()
  }.joined(separator: "\n")
    .replacingOccurrences(of: #"[^\S\n]+"#, with: " ", options: .regularExpression)
    .trimmingCharacters(in: .whitespacesAndNewlines)
  return .init(messageId: message.id, authorName: messageSenderName(message.sender), snippet: snippet,
               attachment: attachment.map { .init(fileName: $0.filename, url: $0.url.absoluteString,
                                                  mediaKind: $0.kind == .image ? .image : .file) })
}

public func canQuoteMessage(_ message: Components.Schemas.ChatRoomMessage) -> Bool {
  message.deletedAt == nil && !isOutboundLocalMessage(message)
    && !message.id.hasPrefix("stream:") && message.membership == nil
}

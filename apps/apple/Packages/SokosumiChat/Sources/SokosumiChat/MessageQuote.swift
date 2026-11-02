import CoreAPI
import Foundation

/// Local preview only. Core builds the authoritative snapshot from the source ID.
public func messageQuote(from message: Components.Schemas.ChatRoomMessage) -> Components.Schemas.ChatRoomMessageQuote? {
  guard canQuoteMessage(message) else { return nil }
  func paragraphs(_ blocks: [MessageMarkdownBlock]) -> [AttributedString] {
    blocks.flatMap { [$0.text] + paragraphs($0.children) }
  }
  let content = message.content.replacingOccurrences(of: #"```[\s\S]*?```"#, with: " ", options: .regularExpression)
  let texts = paragraphs(MessageMarkdown(content).blocks)
  var linked = Set<URL>()
  let attachments = texts.flatMap { MessageAttachmentSegment.split($0, linksAreAttachments: true).compactMap(\.attachment) }
    .filter { linked.insert($0.url).inserted }
  // From the runs: `split` trims the lines beside an attachment for layout, which would glue the words around a lifted link.
  let snippet = texts.map { text in
    text.runs.map { run in run.link.map(linked.contains) == true ? "" : String(text[run.range].characters) }.joined()
  }.joined(separator: "\n")
    .replacingOccurrences(of: #"[^\S\n]+"#, with: " ", options: .regularExpression)
    .trimmingCharacters(in: .whitespacesAndNewlines)
  return .init(messageId: message.id, authorName: messageSenderName(message.sender), snippet: snippet,
               attachments: attachments.map { .init(fileName: $0.filename, url: $0.url.absoluteString,
                                                    mediaKind: $0.kind == .image ? .image : .file) })
}

/// A mention shell that is still thinking has no actions, like web's
/// `showActions`; a failed shell keeps quote/pin/reactions.
public func canQuoteMessage(_ message: Components.Schemas.ChatRoomMessage) -> Bool {
  MessageKind(message) == .confirmed && MentionThoughtShell(message: message)?.isThinking != true
}

/// Message link of a quote sent to yourself from another room. Same-room quotes scroll the transcript instead.
public func quoteSourceURL(_ quote: Components.Schemas.ChatRoomMessageQuote, inRoom roomId: String, webBaseURL: URL) -> URL? {
  guard let sourceRoomId = quote.roomId, sourceRoomId != roomId else { return nil }
  return ChatLink.href(roomId: sourceRoomId, messageId: quote.messageId, webBaseURL: webBaseURL)
}

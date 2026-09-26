import CoreAPI
import Foundation

/// What a pin row prints under its sender and time.
///
/// A quote can be the whole message (Send to yourself posts only a quote). Web shows what was
/// quoted then, and only then: `content.trim().length === 0 ? message.quote : null`. The quote is
/// the snapshot stored on the message, so it outlives the quoted message.
public enum PinnedMessagePreview: Equatable, Sendable {
  case body(String)
  case quote(author: String, snippet: String)

  public init(content: String, quote: Components.Schemas.ChatRoomMessageQuote?) {
    if let quote, content.unicodeScalars.allSatisfy(Self.isTrimmedByJavaScript) {
      self = .quote(author: quote.authorName, snippet: quote.snippet)
    } else {
      self = .body(content)
    }
  }

  /// `String.prototype.trim`: tab, VT, FF, U+FEFF and every space separator, plus LF, CR, LS and PS.
  /// Foundation's `whitespacesAndNewlines` differs: it has U+0085 and U+200B and lacks U+FEFF.
  private static func isTrimmedByJavaScript(_ scalar: Unicode.Scalar) -> Bool {
    switch scalar.value {
    case 0x09 ... 0x0D, 0x2028, 0x2029, 0xFEFF: true
    default: scalar.properties.generalCategory == .spaceSeparator
    }
  }

  public init(_ message: Components.Schemas.ChatRoomPinnedMessageListItem.MessagePayload) {
    self.init(content: message.content, quote: message.quote)
  }

  /// Markdown the row renders: the body, or the quoted snippet.
  public var source: String {
    switch self {
    case let .body(content): content
    case let .quote(_, snippet): snippet
    }
  }

  /// Printed as stored. Core writes "Someone" for an unknown sender; web adds no fallback.
  public var quotedAuthor: String? {
    if case let .quote(author, _) = self {
      author
    } else {
      nil
    }
  }

  /// Spoken in place of the quote block; nil leaves a body to its own text.
  public var accessibilityLabel: String? {
    guard case let .quote(author, snippet) = self else { return nil }
    let name = author.trimmingCharacters(in: .whitespacesAndNewlines)
    let text = snippet.trimmingCharacters(in: .whitespacesAndNewlines)
    let heading = name.isEmpty ? "Quote" : "Quote from \(name)"
    return text.isEmpty ? heading : "\(heading): \(text)"
  }
}

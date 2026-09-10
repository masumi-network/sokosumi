import Foundation

/// Core and web measure JavaScript string length: UTF-16 code units,
/// not Swift grapheme clusters. Limits apply after trimming.
public struct ComposerContent: Equatable, Sendable {
  public static let maximumLength = 10000
  public static let counterThreshold = 9500
  public let text: String
  public var count: Int {
    text.utf16.count
  }

  public var isTooLong: Bool {
    count > Self.maximumLength
  }

  public var canSend: Bool {
    !text.isEmpty && !isTooLong
  }

  public var showsCounter: Bool {
    count >= Self.counterThreshold
  }

  public init(_ raw: String) {
    // ECMAScript WhiteSpace and LineTerminator characters used by trim().
    let whitespace = CharacterSet(charactersIn: "\u{0009}\u{000A}\u{000B}\u{000C}\u{000D}\u{0020}\u{00A0}\u{1680}\u{2000}\u{2001}\u{2002}\u{2003}\u{2004}\u{2005}\u{2006}\u{2007}\u{2008}\u{2009}\u{200A}\u{2028}\u{2029}\u{202F}\u{205F}\u{3000}\u{FEFF}")
    text = raw.trimmingCharacters(in: whitespace)
  }
}

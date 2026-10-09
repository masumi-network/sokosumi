import CoreAPI
import Foundation

/// Web `SocialPostPreview` as a chat `social_post` result draws it (row 38g; web `result-previews.tsx` passes the
/// preview's `social` object, the post's text and its image and video outputs). It stands in for the whole result card:
/// no header, status, question, outputs list, recorded time or source link. Core captures the network, the connected
/// account and the time with the result and does not refresh them on a later read; only the media are re-checked for
/// each viewer.
public struct ResultSocialPost: Equatable, Sendable {
  public typealias Provider = Components.Schemas.ChatResultAvailable.SocialPayload.ProviderPayload

  /// Web `SocialPostMediaRef.kind`, from the output's content type.
  public enum MediaKind: Equatable, Sendable {
    case image
    case gif
    case video
  }

  /// One picture or video of the post: an output with a `previewHref` whose type is an image or a video.
  public struct Media: Equatable, Identifiable, Sendable {
    /// The output's id on the result card (`openHref` and position).
    public let id: String
    public let name: String
    public let kind: MediaKind
    /// The Core content operation behind web's `previewHref`; nil when the app cannot load it itself.
    public let source: ResultOutputSource?
    /// The loaded file's name.
    public let fileName: String
  }

  /// A run of the post's text (web `PreviewRichText`): plain, or a link, hashtag or mention in the network's link
  /// colour. A link shows without its scheme and `www.`, cut to 25 characters.
  public struct TextRun: Equatable, Sendable {
    public let text: String
    public let isToken: Bool

    public init(_ text: String, isToken: Bool = false) {
      self.text = text
      self.isToken = isToken
    }
  }

  /// Web's `useFold`: the first lines, cut at a character budget, behind the network's "more".
  public struct Fold: Equatable, Sendable {
    public let visibleText: String
    public let isFolded: Bool
  }

  /// Web's grid shows at most four pictures (`PreviewMediaGrid`).
  public static let visibleMediaLimit = 4
  /// LinkedIn folds after three lines or 210 characters, Instagram after two lines or 125.
  public static let linkedInFold = (maxChars: 210, maxLines: 3)
  public static let instagramFold = (maxChars: 125, maxLines: 2)

  public let provider: Provider
  /// The connected account as Core captured it; each may be missing.
  public let handle: String?
  public let displayName: String?
  public let avatarURL: String?
  /// Web: `result.summary ?? result.title`.
  public let text: String
  /// Web: when it was published, else when it is scheduled, else when the result was recorded.
  public let timestamp: Date
  public let media: [Media]

  init(provider: Provider, handle: String?, displayName: String?, avatarURL: String?, text: String, timestamp: Date, media: [Media]) {
    self.provider = provider
    self.handle = handle
    self.displayName = displayName
    self.avatarURL = avatarURL
    self.text = text
    self.timestamp = timestamp
    self.media = media
  }

  /// Web draws the preview only for a `social_post` result that carries its `social` object; any other keeps the
  /// generic card.
  init?(_ result: Components.Schemas.ChatResultAvailable) {
    guard result.kind == .socialPost, let social = result.social else { return nil }
    provider = social.provider
    handle = social.account?.handle
    displayName = social.account?.displayName
    avatarURL = social.account?.avatarUrl.flatMap { $0.isEmpty ? nil : $0 }
    // `??` keeps an empty summary, as web's does.
    text = result.summary ?? result.title
    timestamp = social.timestamp ?? result.capturedAt
    media = (result.outputs ?? []).enumerated().compactMap { index, output in
      guard let previewHref = output.previewHref, !previewHref.isEmpty, let type = output.contentType,
            let kind = Self.mediaKind(type) else { return nil }
      return Media(id: "\(output.openHref)-\(index)", name: output.name, kind: kind, source: ResultOutputSource(href: previewHref),
                   fileName: ResultPreviewCard.Output.fileName(name: output.name, contentType: type))
    }
  }

  /// Web `accountName`: the display name, else the handle without its `@`, else the fallback ("Your account").
  public func name(fallback: String) -> String {
    displayName ?? handle.map(Self.droppingAt) ?? fallback
  }

  /// Web `accountHandle`: the handle with one leading `@`; nil without one.
  public var atHandle: String? {
    guard let handle, !handle.isEmpty else { return nil }
    return handle.hasPrefix("@") ? handle : "@" + handle
  }

  /// Instagram heads the post with the handle (without `@`), else the account's name.
  public func instagramName(fallback: String) -> String {
    handle.map(Self.droppingAt) ?? name(fallback: fallback)
  }

  /// Web `X`, `LinkedIn`, … (`socialPostProviderLabel`); brand names, never translated.
  public var providerName: String {
    switch provider {
    case .x: "X"
    case .linkedin: "LinkedIn"
    case .facebook: "Facebook"
    case .instagram: "Instagram"
    case .tiktok: "TikTok"
    case .youtube: "YouTube"
    }
  }

  /// The pictures web's grid draws.
  public var visibleMedia: [Media] {
    Array(media.prefix(Self.visibleMediaLimit))
  }

  /// Web `getInitials`: two words' first letters, or a single word's first two letters, upper-cased; "?" for none.
  public static func initials(_ name: String) -> String {
    let words = name.split(whereSeparator: \.isWhitespace)
    guard let first = words.first else { return "?" }
    let letters = words.count == 1 ? String(first.prefix(2)) : words.compactMap { $0.first.map(String.init) }.joined()
    return String(letters.uppercased().prefix(2))
  }

  /// Web `useFold` before "more" is pressed. Web counts UTF-16 code units, as here.
  public static func fold(_ text: String, maxChars: Int, maxLines: Int) -> Fold {
    let lines = text.components(separatedBy: "\n").prefix(maxLines).joined(separator: "\n")
    let head = prefix(lines, utf16Count: maxChars)
    guard head.utf16.count < text.utf16.count else { return Fold(visibleText: text, isFolded: false) }
    // Web `trimEnd()`.
    var visible = Substring(head)
    while visible.last?.isWhitespace == true {
      visible = visible.dropLast()
    }
    return Fold(visibleText: String(visible), isFolded: true)
  }

  /// Web `PreviewRichText`'s runs: links, `#tags` and `@mentions` are tokens; empty runs are dropped.
  public static func runs(_ text: String) -> [TextRun] {
    var runs: [TextRun] = []
    var cursor = text.startIndex
    for match in tokenPattern.matches(in: text, range: NSRange(text.startIndex..., in: text)) {
      guard let range = Range(match.range, in: text) else { continue }
      if cursor < range.lowerBound {
        runs.append(TextRun(String(text[cursor ..< range.lowerBound])))
      }
      let token = String(text[range])
      runs.append(TextRun(token.hasPrefix("http") ? displayURL(token) : token, isToken: true))
      cursor = range.upperBound
    }
    if cursor < text.endIndex {
      runs.append(TextRun(String(text[cursor...])))
    }
    return runs
  }

  /// Web `TOKEN_PATTERN`.
  private static let tokenPattern: NSRegularExpression = {
    do { return try NSRegularExpression(pattern: #"(https?://[^\s]+|#[\p{L}\p{N}_]+|@[\p{L}\p{N}_.]+)"#) } catch {
      preconditionFailure("Invalid token expression: \(error)")
    }
  }()

  private static let urlDisplayMax = 25

  /// Web's `kind`: a video, a GIF or another image; nil for anything else, which web leaves out.
  private static func mediaKind(_ type: String) -> MediaKind? {
    if type.hasPrefix("video/") {
      .video
    } else if type == "image/gif" {
      .gif
    } else if type.hasPrefix("image/") {
      .image
    } else {
      nil
    }
  }

  /// Web `displayUrl`: no scheme or `www.`, cut to 25 characters with an ellipsis.
  private static func displayURL(_ url: String) -> String {
    let bare = url.replacingOccurrences(of: #"^https?://(www\.)?"#, with: "", options: .regularExpression)
    guard bare.utf16.count > urlDisplayMax else { return bare }
    return prefix(bare, utf16Count: urlDisplayMax - 1) + "…"
  }

  private static func droppingAt(_ handle: String) -> String {
    handle.hasPrefix("@") ? String(handle.dropFirst()) : handle
  }

  /// JavaScript's `slice(0, count)`, never splitting a character's surrogate pair.
  private static func prefix(_ text: String, utf16Count count: Int) -> String {
    var length = min(count, text.utf16.count)
    while length > 0 {
      if let head = String(text.utf16.prefix(length)) {
        return head
      }
      length -= 1
    }
    return ""
  }
}

import Foundation

/// A completed room upload. Only public attachment metadata is persisted.
public struct ComposeAttachment: Codable, Equatable, Sendable, Identifiable {
  public var id: String {
    url
  }

  public let url: String
  public let fileName: String
  public let mediaType: String
  /// Bytes, when the upload or the Drive listing reported them; drafts saved before sizes were kept have none.
  public let size: Int?

  public init(url: String, fileName: String, mediaType: String, size: Int? = nil) {
    self.url = url
    self.fileName = fileName
    self.mediaType = mediaType
    self.size = size
  }

  /// The draft chip's file, classified as web's `classifyFilePreview`: the URL's or name's extension,
  /// else the media type, so an extensionless upload still previews as an image. Nil without a web URL.
  public var preview: MessageAttachment? {
    guard let url = URL(string: url) else { return nil }
    let type = mediaType.lowercased()
    let hint: MessageAttachment.Kind = type.hasPrefix("image/") ? .image : type.hasPrefix("audio/") ? .audio : type.hasPrefix("video/") ? .video : .file
    return MessageAttachment(url: url, label: fileName, kindHint: hint)
  }

  /// Web's chip tooltip: the file name, then its size when known.
  public func metadata(locale: Locale = .autoupdatingCurrent) -> String {
    guard let size else { return fileName }
    return fileName + "\n" + Int64(size).formatted(.byteCount(style: .file).locale(locale))
  }

  public static func message(_ text: String, attachments: [Self]) -> String {
    let links = attachments.map { attachment in
      let name = attachment.fileName.replacingOccurrences(of: "[", with: "").replacingOccurrences(of: "]", with: "").replacingOccurrences(of: "\n", with: " ")
      let url = attachment.url.replacingOccurrences(of: "(", with: "%28").replacingOccurrences(of: ")", with: "%29")
      return "[\(name.isEmpty ? "file" : name)](\(url))"
    }.joined(separator: "\n")
    return [ComposerContent(text).text, links].filter { !$0.isEmpty }.joined(separator: "\n")
  }
}

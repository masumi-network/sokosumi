import Foundation

/// A completed room upload. Only public attachment metadata is persisted.
public struct ComposeAttachment: Codable, Equatable, Sendable, Identifiable {
  public var id: String {
    url
  }

  public let url: String
  public let fileName: String
  public let mediaType: String

  public init(url: String, fileName: String, mediaType: String) {
    self.url = url
    self.fileName = fileName
    self.mediaType = mediaType
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

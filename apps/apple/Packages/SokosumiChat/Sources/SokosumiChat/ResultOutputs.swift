import Foundation
import UniformTypeIdentifiers

/// Where a result output's bytes live in Core (row 38e2). Core writes each protected output's hrefs as web routes that
/// proxy one Core content operation with the browser's session (`chat-result-preview.service.ts`); the app calls that
/// operation itself with its bearer token. Anything else, such as a Drive file's or the Studio's web page, stays a
/// web link.
public enum ResultOutputSource: Hashable, Sendable {
  /// Whose Drive the file is in (`GET /drive/resources/{id}/content`'s `scope`).
  public enum DriveScope: String, Hashable, Sendable {
    case personal = "me"
    case organization = "org"
  }

  /// `/api/drive/files/{id}/content?scope=…&organizationId=…[&download=true]` → `GET /drive/resources/{id}/content`.
  case driveFile(id: String, scope: DriveScope, organizationId: String?, download: Bool)
  /// `/api/jobs/{id}/files/{fileId}/content[?download=true]` → `GET /jobs/{id}/files/{fileId}/content`.
  case jobFile(jobId: String, fileId: String, download: Bool)
  /// `/api/projects/{projectId}/image-studio/assets/{assetId}/content` → `GET /projects/{id}/image-studio/assets/{assetId}/content`.
  case studioAsset(projectId: String, assetId: String)

  /// The operation behind one of Core's three content hrefs, read as web's proxy routes read them: Drive forwards
  /// `scope` (`me` when absent), `organizationId` and `download=true`, jobs only `download=true`, the Studio nothing.
  public init?(href: String) {
    // Core's `localHref`: one leading slash, never `//` or `/\`.
    guard href.hasPrefix("/"), !href.hasPrefix("//"), !href.hasPrefix("/\\"),
          let components = URLComponents(string: href), components.scheme == nil, components.host == nil else { return nil }
    let path = components.percentEncodedPath.split(separator: "/", omittingEmptySubsequences: false).dropFirst()
      .map { $0.removingPercentEncoding ?? "" }
    guard !path.contains(""), path.first == "api", path.last == "content" else { return nil }
    let query = components.queryItems ?? []
    func value(_ name: String) -> String? {
      query.first { $0.name == name }?.value
    }
    let download = value("download") == "true"
    // Every shape is `api/<route>/content`; the ids sit at fixed places.
    func matches(_ shape: [String?]) -> Bool {
      shape.count == path.count && zip(shape, path).allSatisfy { $0 == nil || $0 == $1 }
    }
    if matches(["api", "drive", "files", nil, "content"]) {
      guard let scope = DriveScope(rawValue: value("scope") ?? DriveScope.personal.rawValue) else { return nil }
      self = .driveFile(id: path[3], scope: scope, organizationId: value("organizationId").flatMap { $0.isEmpty ? nil : $0 }, download: download)
    } else if matches(["api", "jobs", nil, "files", nil, "content"]) {
      self = .jobFile(jobId: path[2], fileId: path[4], download: download)
    } else if matches(["api", "projects", nil, "image-studio", "assets", nil, "content"]) {
      self = .studioAsset(projectId: path[2], assetId: path[5])
    } else {
      return nil
    }
  }
}

/// How web draws an output with a `previewHref` inline (`classifyFilePreview` in `result-previews.tsx`): images, PDF
/// and text as a tile that opens a viewer, audio and video as a player.
public enum ResultOutputPreview: Hashable, Sendable {
  case image
  case audio
  case video
  case pdf
  case text

  private static let imageExtensions: Set = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"]
  private static let videoExtensions: Set = ["mp4", "webm", "ogg", "mov", "m4v"]
  private static let audioExtensions: Set = ["mp3", "wav", "m4a", "aac", "flac", "opus", "oga"]
  private static let officeExtensions: Set = ["doc", "docx", "ppt", "pptx", "xls", "xlsx"]
  private static let officeTypes: Set = [
    "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation", "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  ]
  private static let textExtensions: Set = ["txt", "md", "markdown"]
  private static let textTypes: Set = ["text/plain", "text/markdown", "text/x-markdown"]

  /// Web `classifyFilePreview(href, name, contentType)` narrowed to what a result card draws inline: Office and every
  /// other file are nil.
  public init?(href: String, name: String, contentType: String?) {
    let type = contentType?.split(separator: ";", maxSplits: 1).first?.trimmingCharacters(in: .whitespaces).lowercased()
    let extensions = [Self.fileExtension(href), Self.fileExtension(name)]
    let isAudioType = type?.hasPrefix("audio/") == true
    if type?.hasPrefix("image/") == true || extensions.contains(where: Self.imageExtensions.contains) {
      self = .image
    } else if type?.hasPrefix("video/") == true || (!isAudioType && extensions.contains(where: Self.videoExtensions.contains)) {
      // A type beats the extension: `voice.ogg` typed `audio/ogg` is audio.
      self = .video
    } else if isAudioType || extensions.contains(where: Self.audioExtensions.contains) {
      self = .audio
    } else {
      // Web `getDocumentPreviewKind(href) ?? getDocumentPreviewKind(name)`, Office first.
      for fileExtension in extensions {
        if Self.officeExtensions.contains(fileExtension) || type.map(Self.officeTypes.contains) == true {
          return nil
        }
        if fileExtension == "pdf" || type == "application/pdf" {
          self = .pdf
          return
        }
        if Self.textExtensions.contains(fileExtension) || type.map(Self.textTypes.contains) == true {
          self = .text
          return
        }
      }
      return nil
    }
  }

  /// Web `getExtensionFromUrl` on a relative href or a file name: the last path segment's text after its last dot.
  private static func fileExtension(_ value: String) -> String {
    let last = value.split(separator: "/", omittingEmptySubsequences: false).last ?? ""
    let parts = last.split(separator: ".", omittingEmptySubsequences: false)
    return parts.count > 1 ? parts.last.map { $0.lowercased() } ?? "" : ""
  }
}

/// An output's bytes as a local file, named like the output so Quick Look and the save panel show its name. The file
/// and its folder go when the last holder (the viewer, the player, a save) lets go.
public final class ResultOutputFile: Sendable {
  public let url: URL

  init(url: URL) {
    self.url = url
  }

  deinit {
    try? FileManager.default.removeItem(at: url.deletingLastPathComponent())
  }
}

public extension ResultPreviewCard.Output {
  /// The local file's name: the output's name made safe for a file system, plus its type's extension when the name
  /// does not already end in one of that type (a Studio image is named by its prompt).
  static func fileName(name: String, contentType: String?) -> String {
    var base = String(name.map { "/:\\\0".contains($0) ? "-" : $0 })
      .trimmingCharacters(in: .whitespacesAndNewlines)
    while base.hasPrefix(".") {
      base.removeFirst()
    }
    base = String(base.prefix(200)).trimmingCharacters(in: .whitespacesAndNewlines)
    if base.isEmpty {
      base = "Output"
    }
    let mimeType = contentType?.split(separator: ";", maxSplits: 1).first?.trimmingCharacters(in: .whitespaces).lowercased()
    guard let type = mimeType.flatMap({ UTType(mimeType: $0) }), let preferred = type.preferredFilenameExtension else { return base }
    let current = (base as NSString).pathExtension
    if !current.isEmpty, let named = UTType(filenameExtension: current),
       named.conforms(to: type) || type.conforms(to: named) || (named.isDeclared && Self.sameKind(named, type)) {
      return base
    }
    return "\(base).\(preferred)"
  }

  /// Both an image, both audio or video, or both text: `clip.ogg` (`org.xiph.ogg-audio`) typed `video/ogg`
  /// (`org.xiph.ogv`) is still a media file and keeps its name.
  private static func sameKind(_ first: UTType, _ second: UTType) -> Bool {
    [UTType.image, .audiovisualContent, .text].contains { first.conforms(to: $0) && second.conforms(to: $0) }
  }
}

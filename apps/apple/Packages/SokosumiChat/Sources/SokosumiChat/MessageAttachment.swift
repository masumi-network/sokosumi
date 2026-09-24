import Foundation

public enum MessageAttachmentKindAttribute: AttributedStringKey {
  public typealias Value = MessageAttachment.Kind
  public static let name = "sokosumi.message.attachment-kind"
}

/// File metadata available in message Markdown; size is not carried on the wire.
public struct MessageAttachment: Hashable, Sendable {
  public enum Kind: Hashable, Sendable { case image, audio, video, file }
  public enum DocumentPreviewKind: Sendable { case pdf, text, office }
  public let url: URL
  public let filename: String
  public let kind: Kind

  public var documentPreviewExtension: String? {
    guard kind == .file else { return nil }
    let supported = ["pdf", "txt", "md", "markdown", "doc", "docx", "ppt", "pptx", "xls", "xlsx"]
    return [url.pathExtension.lowercased(), (filename as NSString).pathExtension.lowercased()]
      .first(where: { supported.contains($0) })
  }

  public var documentPreviewKind: DocumentPreviewKind? {
    switch documentPreviewExtension {
    case "pdf": .pdf
    case "txt", "md", "markdown": .text
    case "doc", "docx", "ppt", "pptx", "xls", "xlsx": .office
    default: nil
    }
  }

  public init?(url: URL, label: String, kindHint: Kind? = nil) {
    guard ["http", "https"].contains(url.scheme?.lowercased() ?? ""), url.host != nil else { return nil }
    let ext = url.pathExtension.lowercased()
    let extensions: Set = ["png", "jpg", "jpeg", "webp", "svg", "gif", "pdf", "txt", "md", "markdown", "rtf", "csv", "json", "xml", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "zip", "tar", "gz", "mp3", "mp4", "wav", "mov"]
    guard kindHint != nil || (url.fragment == nil && (extensions.contains(ext) || url.path.contains("/deliverables/"))) else { return nil }
    self.url = url
    filename = label.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? url.lastPathComponent : label
    let hint = ext.isEmpty ? (filename as NSString).pathExtension.lowercased() : ext
    // Filename/extension beat an img/video tag so `![clip](file.mp4)` matches web.
    if ["png", "jpg", "jpeg", "webp", "svg", "gif", "bmp", "heic", "heif"].contains(hint) {
      kind = .image
    } else if ["mp3", "wav", "m4a", "ogg", "aac", "flac"].contains(hint) {
      kind = .audio
    } else if ["mp4", "mov", "webm", "m4v"].contains(hint) {
      kind = .video
    } else if let kindHint {
      kind = kindHint
    } else {
      kind = .file
    }
  }
}

public struct MessageAttachmentSegment: Identifiable, Equatable, Sendable {
  public let id: Int
  public var text: AttributedString
  public var attachment: MessageAttachment?

  /// Reuses parsed Markdown links, preserving text attributes and occurrence order.
  public static func split(_ text: AttributedString, includeFileAttachments: Bool = true) -> [Self] {
    var result: [Self] = []
    var offset = 0
    for run in text.runs {
      let part = AttributedString(text[run.range])
      var attachment = run.link.flatMap { MessageAttachment(url: $0, label: String(part.characters), kindHint: run[MessageAttachmentKindAttribute.self]) }
      if !includeFileAttachments, attachment?.kind == .file {
        attachment = nil
      }
      if let attachment, let last = result.indices.last, result[last].attachment?.url == attachment.url {
        result[last].text.append(part)
        result[last].attachment = MessageAttachment(url: attachment.url, label: String(result[last].text.characters), kindHint: attachment.kind)
      } else if attachment == nil, let last = result.indices.last, result[last].attachment == nil {
        result[last].text.append(part)
      } else {
        result.append(Self(id: offset, text: part, attachment: attachment))
      }
      offset += part.characters.count
    }
    for index in result.indices where result[index].attachment == nil {
      if index > 0, result[index - 1].attachment != nil {
        while result[index].text.characters.first?.isNewline == true {
          result[index].text.removeSubrange(result[index].text.startIndex ..< result[index].text.characters.index(after: result[index].text.startIndex))
        }
      }
      if index + 1 < result.count, result[index + 1].attachment != nil {
        while result[index].text.characters.last?.isNewline == true {
          result[index].text.removeSubrange(result[index].text.characters.index(before: result[index].text.endIndex) ..< result[index].text.endIndex)
        }
      }
    }
    return result
  }
}

extension MessageMarkdown {
  /// Web's `hasLargeSoloImageAttachment` over the linkified source. File links
  /// with only whitespace between them are one row; list markers, quote markers,
  /// rules and table pipes are not whitespace, so they split the row. A code
  /// fence is skipped, so a sample link stays text. When the source has no file
  /// link, images the scan cannot see (`<img>`) still use the parsed document.
  static func longBodyClamps(scanning source: String, blocks: [MessageMarkdownBlock]) -> Bool {
    let groups = MarkdownBareDomains(source).attachmentGroups()
    let rows = groups.isEmpty ? attachmentRows(in: blocks) : groups
    return !rows.contains { $0.count == 1 && $0[0].kind == .image }
  }

  /// Attachments in document order, grouped where only whitespace separates them.
  static func attachmentRows(in blocks: [MessageMarkdownBlock]) -> [[MessageAttachment]] {
    var rows: [[MessageAttachment]] = []
    var open = false
    func walk(_ block: MessageMarkdownBlock) {
      guard block.children.isEmpty else {
        block.children.forEach(walk)
        return
      }
      if case .codeBlock = block.kind {
        open = false
        return
      }
      for segment in MessageAttachmentSegment.split(block.text) {
        if let attachment = segment.attachment {
          if open {
            rows[rows.count - 1].append(attachment)
          } else {
            rows.append([attachment])
            open = true
          }
        } else if !String(segment.text.characters).trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
          open = false
        }
      }
    }
    blocks.forEach(walk)
    return rows
  }
}

import Foundation

public enum MessageAttachmentKindAttribute: AttributedStringKey {
  public typealias Value = MessageAttachment.Kind
  public static let name = "sokosumi.message.attachment-kind"
}

/// File metadata available in message Markdown; size is not carried on the wire.
public struct MessageAttachment: Hashable, Sendable {
  public enum Kind: Hashable, Sendable { case image, audio, video, file }
  public enum DocumentPreviewKind: Sendable { case pdf, text }
  public let url: URL
  public let filename: String
  public let kind: Kind

  public var documentPreviewKind: DocumentPreviewKind? {
    guard kind == .file else { return nil }
    let extensions = [url.pathExtension.lowercased(), (filename as NSString).pathExtension.lowercased()]
    for ext in extensions {
      switch ext {
      case "pdf": return .pdf
      case "txt", "md", "markdown": return .text
      case "doc", "docx", "ppt", "pptx", "xls", "xlsx": return nil
      default: continue
      }
    }
    return nil
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

public extension MessageMarkdown {
  var containsAttachments: Bool {
    func walk(_ block: MessageMarkdownBlock) -> Bool {
      MessageAttachmentSegment.split(block.text).contains { $0.attachment != nil }
        || block.children.contains(where: walk)
    }
    return blocks.contains(where: walk)
  }
}

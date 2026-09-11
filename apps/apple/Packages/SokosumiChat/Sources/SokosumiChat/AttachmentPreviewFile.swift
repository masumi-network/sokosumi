import Foundation

/// Keeps a downloaded Office file alive until the native viewer releases it.
public final class AttachmentPreviewFile: Sendable {
  public let url: URL

  private init(url: URL) {
    self.url = url
  }

  deinit {
    try? FileManager.default.removeItem(at: url)
  }

  public static func load(_ attachment: MessageAttachment, session: URLSession = .shared) async throws -> AttachmentPreviewFile {
    guard attachment.documentPreviewKind == .office, let ext = attachment.documentPreviewExtension else {
      throw AttachmentDownload.Failure.invalidResponse
    }
    let temporary = try await AttachmentDownload.fetch(attachment.url, session: session)
    defer { try? FileManager.default.removeItem(at: temporary) }
    // Quick Look selects a native viewer from the local file extension.
    let destination = temporary.appendingPathExtension(ext)
    try FileManager.default.moveItem(at: temporary, to: destination)
    let file = AttachmentPreviewFile(url: destination)
    try Task.checkCancellation()
    return file
  }
}

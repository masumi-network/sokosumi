import Combine
import Foundation

/// Per-composer uploads. Switching room or closing its thread cancels unfinished work.
@MainActor
public final class ComposeUploads: ObservableObject {
  @Published public private(set) var attachments: [ComposeAttachment]
  @Published public private(set) var uploadingName: String?
  @Published public private(set) var errorMessage: String?
  private let savedDraft: SavedComposeDraft
  private var task: Task<Void, Never>?
  private var generation = 0

  public init(savedDraft: SavedComposeDraft) {
    self.savedDraft = savedDraft
    attachments = savedDraft.loadAttachments()
  }

  public func add(_ attachment: ComposeAttachment) {
    guard !attachments.contains(where: { $0.url == attachment.url }) else { return }
    attachments.append(attachment)
    savedDraft.saveAttachments(attachments)
  }

  public func remove(_ attachment: ComposeAttachment) {
    attachments.removeAll { $0.id == attachment.id }
    savedDraft.saveAttachments(attachments)
  }

  public func clear() {
    attachments = []
    savedDraft.saveAttachments([])
  }

  public func cancel() {
    generation += 1
    task?.cancel()
    task = nil
    uploadingName = nil
  }

  public func report(_ error: Error) {
    switch error {
    case let ChatServiceError.unauthorized(message), let ChatServiceError.unprocessable(_, message), let ChatServiceError.unexpectedResponse(message):
      errorMessage = message
    default: errorMessage = error.localizedDescription
    }
  }

  public func upload(_ files: [URL], using upload: @escaping @MainActor (URL) async throws -> ComposeAttachment) {
    startUpload(files, cleanupDirectory: nil, using: upload)
  }

  public func upload(_ data: Data, filename: String, using upload: @escaping @MainActor (URL) async throws -> ComposeAttachment, completed: (() -> Void)? = nil) {
    guard task == nil else { return }
    let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
    do {
      try AttachmentUpload.validate(size: data.count)
      try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
      let file = folder.appendingPathComponent((filename as NSString).lastPathComponent)
      try data.write(to: file, options: .atomic)
      startUpload([file], cleanupDirectory: folder, using: upload, completed: completed)
    } catch {
      try? FileManager.default.removeItem(at: folder)
      report(error)
    }
  }

  private func startUpload(_ files: [URL], cleanupDirectory: URL?, using upload: @escaping @MainActor (URL) async throws -> ComposeAttachment, completed: (() -> Void)? = nil) {
    guard task == nil, !files.isEmpty else { return }
    errorMessage = nil
    uploadingName = files[0].lastPathComponent
    let current = generation
    task = Task { [weak self] in
      defer {
        if let cleanupDirectory {
          try? FileManager.default.removeItem(at: cleanupDirectory)
        }
      }
      guard let self else { return }
      do {
        for file in files {
          try Task.checkCancellation()
          uploadingName = file.lastPathComponent
          let attachment = try await upload(file)
          try Task.checkCancellation()
          guard current == generation else { return }
          add(attachment)
        }
        completed?()
      } catch {
        guard current == generation else { return }
        if !Task.isCancelled {
          report(error)
        }
      }
      guard current == generation else { return }
      uploadingName = nil
      task = nil
    }
  }
}

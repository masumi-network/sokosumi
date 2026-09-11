import Foundation
import SokosumiAuth
import SokosumiChat

public extension WorkspaceState {
  func canAttachFiles(roomId: String) -> Bool {
    transcriptRoomId == roomId && !transcriptLoading && directStream.roomId != roomId
  }

  func uploadAttachment(_ file: URL, roomId: String, auth: AuthState) async throws -> ComposeAttachment {
    guard canAttachFiles(roomId: roomId), let client = resolveClient(auth: auth) else {
      throw ChatServiceError.unexpectedResponse("Attachments are not available in this conversation.")
    }
    let generation = timeline.generation
    let slug = selection?.workspace.organizationSlug
    let scoped = file.startAccessingSecurityScopedResource()
    defer {
      if scoped {
        file.stopAccessingSecurityScopedResource()
      }
    }
    let resource = try file.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey])
    guard resource.isRegularFile == true, let size = resource.fileSize else { throw AttachmentUpload.Failure.invalidFile }
    try AttachmentUpload.validate(size: size)
    let contentType = try AttachmentUpload.contentType(filename: file.lastPathComponent)
    do {
      let grant = try await ChatService().attachmentGrant(client: client, roomId: roomId, file: .init(filename: file.lastPathComponent, contentType: contentType, size: size), organizationSlug: slug)
      try Task.checkCancellation()
      guard generation == timeline.generation else { throw CancellationError() }
      return try await AttachmentUpload.put(file: file, filename: file.lastPathComponent, contentType: contentType, size: size, grant: grant)
    } catch let error as ChatServiceError {
      if !Task.isCancelled, generation == timeline.generation {
        _ = signOutIfUnauthorized(error, auth: auth)
      }
      throw error
    }
  }
}

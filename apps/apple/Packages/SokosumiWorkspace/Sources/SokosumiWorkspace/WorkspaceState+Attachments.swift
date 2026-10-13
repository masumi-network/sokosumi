import CoreAPI
import Foundation
import SokosumiAuth
import SokosumiChat

public extension WorkspaceState {
  /// Every attachment ingress (drop, paste, picker, Drive) asks this; Core refuses uploads to a Read-only Direct.
  func canAttachFiles(roomId: String) -> Bool {
    transcriptRoomId == roomId && !transcriptLoading && roomTakesNewMessages(rooms.first { $0.id == roomId })
  }

  func driveItems(folder: String, query: String, roomId: String) async throws -> [Components.Schemas.DriveItem] {
    guard canAttachFiles(roomId: roomId) else {
      throw ChatServiceError.unexpectedResponse("Attachments are not available in this conversation.")
    }
    let generation = room.timeline.generation
    return try await request(signIn: "Attachments are not available in this conversation.") { service, client, _ in
      let items = try await service.driveItems(client: client, organizationId: selection?.workspace.organizationId, folder: folder, query: query)
      try Task.checkCancellation()
      guard generation == room.timeline.generation else { throw CancellationError() }
      return items
    }
  }

  func uploadAttachment(_ file: URL, roomId: String) async throws -> ComposeAttachment {
    guard canAttachFiles(roomId: roomId) else {
      throw ChatServiceError.unexpectedResponse("Attachments are not available in this conversation.")
    }
    let generation = room.timeline.generation
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
    return try await request(signIn: "Attachments are not available in this conversation.") { service, client, slug in
      let grant = try await service.attachmentGrant(client: client, roomId: roomId, file: .init(filename: file.lastPathComponent, contentType: contentType, size: size), organizationSlug: slug)
      try Task.checkCancellation()
      guard generation == room.timeline.generation else { throw CancellationError() }
      return try await AttachmentUpload.put(file: file, filename: file.lastPathComponent, contentType: contentType, size: size, grant: grant)
    }
  }
}

public extension WorkspaceState {
  /// The composer's skill picker search (row 42): Core's skills.sh catalog for `query`, the top skills when empty.
  func searchSkills(_ query: String) async throws -> [Components.Schemas.ChatSkillCatalogItem] {
    try await request(signIn: "Sign-in is not configured.") { service, client, _ in
      try await service.searchSkills(client: client, query: query)
    }
  }
}

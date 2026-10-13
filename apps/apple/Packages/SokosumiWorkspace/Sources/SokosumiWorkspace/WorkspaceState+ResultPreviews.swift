import CoreAPI
import SokosumiAuth
import SokosumiChat

public extension WorkspaceState {
  /// A Soko Bot message's recorded results as this viewer may see them (row 38e1, web `AuthorizedResultPreviews`).
  /// Web keeps the answer in the row only (`gcTime: 0`), so the row asks again whenever it appears; a 401 signs
  /// out like every other chat request, anything else reaches the row as its "could not be loaded" line.
  func messageResultPreviews(_ message: Components.Schemas.ChatRoomMessage) async throws -> [Components.Schemas.ChatResultPreview] {
    try await request(signIn: "Log in to see results.") { service, client, slug in
      try await service.messageResults(client: client, roomId: message.roomId, messageId: message.id, organizationSlug: slug)
    }
  }

  /// Accepts or rejects a Soko Bot decision from its result card (row 38h2, web `resolveSokoBotDecisionAction`).
  /// Decisions are the owner's, so no workspace travels with it; the card reads its results again afterwards to show
  /// the settled state. A 401 signs out, anything else reaches the card with Core's message.
  func resolveSokoBotDecision(_ decisionId: String, _ resolution: SokoBotDecision.Resolution) async throws {
    _ = try await request(signIn: "Log in to resolve the approval.") { service, client, _ in
      try await service.resolveSokoBotDecision(client: client, decisionId: decisionId, resolution: resolution)
    }
  }

  /// One protected output's bytes as a local file named `fileName` (row 38e2), through the Core operation its href names
  /// and in the open workspace, as web's proxy routes call Core with the session. Web keeps no copy beyond the
  /// browser's revalidated one, so each preview, Open or Download asks again; a 401 signs out.
  func resultOutput(_ source: ResultOutputSource, fileName: String) async throws -> ResultOutputFile {
    try await request(signIn: "Log in to open this file.") { service, client, slug in
      try await service.resultOutput(client: client, source: source, fileName: fileName, organizationSlug: slug)
    }
  }
}

public extension WorkspaceState {
  /// Answers a Soko Bot's `project_selection` card with the picked project (row 38h1, web `selectChatProjectAction`).
  /// The saved reply lands in the room or its Thread at once, as its realtime copy would; a 401 signs out like every
  /// other chat request, anything else reaches the picker as "Could not send your choice".
  func selectProject(_ projectId: String, preview previewId: String, question message: Components.Schemas.ChatRoomMessage) async throws {
    let reply = try await request(signIn: "Log in to send your choice.") { service, client, slug in
      try await service.selectProject(client: client, question: message, previewId: previewId, projectId: projectId,
                                      userId: currentUserId, organizationSlug: slug)
    }
    applyRealtimeMessage(roomId: reply.roomId, eventType: .create, message: reply)
  }
}

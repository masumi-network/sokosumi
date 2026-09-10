import Combine
import CoreAPI
import Foundation
import OpenAPIRuntime

/// One visible Direct stream. Leaving cancels local consumption; Core can keep
/// generating, and the next open reconnects through the active-stream endpoint.
@MainActor
public final class DirectStreamSession: ObservableObject {
  public enum Phase { case idle, resuming, submitted, streaming, settling }

  @Published public private(set) var phase = Phase.idle
  @Published public private(set) var errorMessage: String?
  @Published private var response = DirectStreamMessage()
  @Published private var userMessage: Components.Schemas.ChatRoomMessage?
  public private(set) var task: Task<Void, Never>?
  public private(set) var roomId: String?
  private var sender: Components.Schemas.ChatRoomUserParticipant?
  private var coworker: Components.Schemas.ChatRoomCoworkerParticipant?
  private var generation = UUID()
  private var responseDate = Date()
  private var hasResponse = false
  private let service = ChatService()

  public init() {}

  public var isBusy: Bool {
    phase != .idle
  }

  public var reasoning: String {
    response.reasoning
  }

  public var latestThought: String? {
    response.latestThought
  }

  public static func supports(_ room: Components.Schemas.ChatRoom) -> Bool {
    room.kind == .direct && room.coworkerMembers.count == 1
      && room.userMembers.count == 1 && room.sokoBotMembers.isEmpty
  }

  public func reset(room: Components.Schemas.ChatRoom? = nil) {
    generation = UUID()
    task?.cancel()
    task = nil
    roomId = room.flatMap { Self.supports($0) ? $0.id : nil }
    sender = roomId == nil ? nil : room?.userMembers.first
    coworker = roomId == nil ? nil : room?.coworkerMembers.first
    clearOverlay()
    errorMessage = nil
    phase = .idle
  }

  public var overlayMessages: [Components.Schemas.ChatRoomMessage] {
    var messages = userMessage.map { [$0] } ?? []
    if hasResponse, let roomId, let coworker {
      messages.append(.init(
        id: "stream:" + (response.id ?? "resume-pending"), roomId: roomId,
        parentMessageId: nil, content: response.text, createdAt: responseDate,
        deletedAt: nil, editedAt: nil,
        sender: .case2(.init(_type: .coworker, coworker: coworker)),
        mentions: [], reactions: [], threadReplyCount: 0, threadLastReplyAt: nil,
        metadata: nil, quote: nil, membership: nil, unfurls: nil
      ))
    }
    return messages
  }

  /// Core persists the user before streaming the answer. Hide just the newest
  /// matching user occurrence while its overlay is visible, as web does.
  public func displayedMessages(persisted: [Components.Schemas.ChatRoomMessage]) -> [Components.Schemas.ChatRoomMessage] {
    let overlay = overlayMessages
    guard !overlay.isEmpty else { return persisted }
    let ids = Set(overlay.map(\.id))
    let duplicate = userMessage.flatMap { user in
      persisted.last { message in
        guard case .case1 = message.sender, !ids.contains(message.id) else { return false }
        return ComposerContent(message.content).text == user.content
      }?.id
    }
    return persisted.filter { !ids.contains($0.id) && $0.id != duplicate } + overlay
  }

  public func resume(
    client: Client, organizationSlug: String?,
    settled: @escaping () async -> Bool, failed: @escaping (Error) -> Void
  ) {
    guard let roomId, !isBusy else { return }
    phase = .resuming
    run(body: { [service] in
      try await service.resumeDirectStream(client: client, roomId: roomId, organizationSlug: organizationSlug)
    }, settled: settled, failed: failed)
  }

  @discardableResult
  public func send(
    _ content: String, client: Client, organizationSlug: String?,
    settled: @escaping () async -> Bool, failed: @escaping (Error) -> Void
  ) -> Bool {
    let draft = ComposerContent(content)
    guard let roomId, let sender, !isBusy, draft.canSend else { return false }
    clearOverlay()
    let id = UUID().uuidString
    var message = chatRoomMessage(from: .init(clientTurnId: id, roomId: roomId, content: draft.text, sender: sender))
    message.id = "stream:" + id
    message.metadata = nil
    userMessage = message
    phase = .submitted
    run(body: { [service] in
      try await service.startDirectStream(client: client, roomId: roomId, organizationSlug: organizationSlug,
                                          messageId: id, text: draft.text)
    }, settled: settled, failed: failed)
    return true
  }

  private func run(
    body: @escaping () async throws -> HTTPBody?,
    settled: @escaping () async -> Bool, failed: @escaping (Error) -> Void
  ) {
    let token = generation
    errorMessage = nil
    task = Task { [weak self] in
      guard let self else { return }
      defer {
        if generation == token {
          phase = .idle
          task = nil
        }
      }
      do {
        guard let body = try await body() else { return }
        guard generation == token, !Task.isCancelled else { return }
        hasResponse = true
        responseDate = Date()
        phase = .streaming
        try await consume(body, token: token)
        guard generation == token, !Task.isCancelled else { return }
        guard response.finished else {
          throw ChatServiceError.unexpectedResponse("The coworker response ended unexpectedly.")
        }
        phase = .settling
        let refreshed = await settled()
        guard generation == token, !Task.isCancelled else { return }
        if refreshed {
          clearOverlay()
        }
      } catch {
        guard generation == token, !Task.isCancelled else { return }
        errorMessage = friendlyMessage(for: error)
        failed(error)
      }
    }
  }

  private func consume(_ body: HTTPBody, token: UUID) async throws {
    for try await event in body.asDecodedServerSentEvents(while: { !$0.elementsEqual("[DONE]".utf8) }) {
      try Task.checkCancellation()
      guard generation == token else { throw CancellationError() }
      guard let data = event.data else { continue }
      try response.receive(data)
    }
  }

  private func clearOverlay() {
    userMessage = nil
    response = .init()
    hasResponse = false
  }
}

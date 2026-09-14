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
  @Published public private(set) var restoredDraft: String?
  public private(set) var restoredQuote: Components.Schemas.ChatRoomMessageQuote?
  @Published public private(set) var parentMessageId: String?
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
  private var scope: [String]?
  private var retainedParents: [[String]: String] = [:]

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

  public func reset(room: Components.Schemas.ChatRoom? = nil, userId: String? = nil, organizationId: String? = nil) {
    generation = UUID()
    task?.cancel()
    task = nil
    roomId = room.flatMap { Self.supports($0) ? $0.id : nil }
    scope = roomId.map { [userId ?? room?.userMembers.first?.id ?? "", organizationId == nil ? "personal" : "organization", organizationId ?? "", $0] }
    parentMessageId = scope.flatMap { retainedParents[$0] }
    sender = roomId == nil ? nil : room?.userMembers.first
    coworker = roomId == nil ? nil : room?.coworkerMembers.first
    clearOverlay()
    restoredDraft = nil
    restoredQuote = nil
    errorMessage = nil
    phase = .idle
  }

  public func consumeRestoredDraft() {
    restoredDraft = nil
    restoredQuote = nil
  }

  public func restoredDraft(for roomId: String, parentMessageId: String?) -> String? {
    guard self.roomId == roomId, self.parentMessageId == parentMessageId, let text = restoredDraft, !text.isEmpty else {
      return nil
    }
    return text
  }

  public var overlayMessages: [Components.Schemas.ChatRoomMessage] {
    var messages = userMessage.map { [$0] } ?? []
    if hasResponse, let roomId, let coworker {
      messages.append(.init(
        id: "stream:" + (response.id ?? "resume-pending"), roomId: roomId,
        parentMessageId: parentMessageId, content: response.text, createdAt: responseDate,
        deletedAt: nil, editedAt: nil,
        sender: .case2(.init(_type: .coworker, coworker: coworker)),
        mentions: [], reactions: [], threadReplyCount: 0, threadLastReplyAt: nil,
        metadata: nil, quote: nil, membership: nil, unfurls: nil
      ))
    }
    return messages
  }

  /// Core persists the user (and later the coworker) before overlays clear.
  /// Hide the newest matching occurrence of each overlay role so settlement
  /// cannot flash a duplicate bubble.
  public func displayedMessages(persisted: [Components.Schemas.ChatRoomMessage], parentMessageId: String? = nil) -> [Components.Schemas.ChatRoomMessage] {
    let overlay = overlayMessages.filter { $0.parentMessageId == parentMessageId }
    guard !overlay.isEmpty else { return persisted }
    let ids = Set(overlay.map(\.id))
    let hidden = Set(overlay.compactMap { row in newestPersistedDuplicate(of: row, in: persisted, overlayIds: ids) })
    return persisted.filter { !ids.contains($0.id) && !hidden.contains($0.id) } + overlay
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
    _ content: String, client: Client, organizationSlug: String?, parentMessageId: String? = nil,
    quote: Components.Schemas.ChatRoomMessageQuote? = nil,
    settled: @escaping () async -> Bool, failed: @escaping (Error) -> Void
  ) -> Bool {
    let draft = ComposerContent(content)
    guard let roomId, let sender, !isBusy, draft.canSend else { return false }
    restoredDraft = nil
    restoredQuote = nil
    self.parentMessageId = parentMessageId
    if let scope {
      retainedParents[scope] = parentMessageId
    }
    clearOverlay()
    let id = UUID().uuidString
    var message = chatRoomMessage(from: .init(clientTurnId: id, roomId: roomId, content: draft.text, quote: quote, sender: sender))
    message.id = "stream:" + id
    message.metadata = nil
    message.parentMessageId = parentMessageId
    userMessage = message
    phase = .submitted
    run(body: { [service] in
      try await service.startDirectStream(client: client, roomId: roomId, organizationSlug: organizationSlug,
                                          messageId: id, text: draft.text, parentMessageId: parentMessageId, quoteMessageId: quote?.messageId)
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
        guard let body = try await body() else {
          if generation == token {
            forgetRetainedParent()
            parentMessageId = nil
          }
          return
        }
        guard generation == token, !Task.isCancelled else { return }
        hasResponse = true
        responseDate = Date()
        phase = .streaming
        try await consume(body, token: token)
        guard generation == token, !Task.isCancelled else { return }
        guard response.finished else {
          throw ChatServiceError.unexpectedResponse("The coworker response ended unexpectedly.")
        }
        await reconcile(token: token, settled: settled)
      } catch {
        guard generation == token, !Task.isCancelled else { return }
        forgetRetainedParent()
        errorMessage = friendlyMessage(for: error)
        failed(error)
        if hasResponse {
          await reconcile(token: token, settled: settled)
        } else {
          restoredQuote = userMessage?.quote
          restoredDraft = userMessage.map { ComposerContent($0.content).text }
          clearOverlay()
        }
      }
    }
  }

  private func forgetRetainedParent() {
    if let scope {
      retainedParents[scope] = nil
    }
  }

  private func reconcile(token: UUID, settled: () async -> Bool) async {
    guard hasResponse, generation == token, !Task.isCancelled else { return }
    phase = .settling
    let refreshed = await settled()
    guard generation == token, !Task.isCancelled else { return }
    if refreshed {
      if let scope {
        retainedParents[scope] = nil
      }
      clearOverlay()
      parentMessageId = nil
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

  private func newestPersistedDuplicate(
    of overlay: Components.Schemas.ChatRoomMessage,
    in persisted: [Components.Schemas.ChatRoomMessage],
    overlayIds: Set<String>
  ) -> String? {
    let text = ComposerContent(overlay.content).text
    guard !text.isEmpty else { return nil }
    return persisted.last { message in
      guard message.parentMessageId == overlay.parentMessageId, message.quote?.messageId == overlay.quote?.messageId, !overlayIds.contains(message.id), sameSenderKind(message, overlay) else { return false }
      return ComposerContent(message.content).text == text
    }?.id
  }

  private func sameSenderKind(
    _ left: Components.Schemas.ChatRoomMessage,
    _ right: Components.Schemas.ChatRoomMessage
  ) -> Bool {
    switch (left.sender, right.sender) {
    case (.case1, .case1), (.case2, .case2): true
    default: false
    }
  }
}

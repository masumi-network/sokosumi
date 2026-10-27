import CoreAPI
import Foundation

/// Distinguishes a missing target from a jump the reader already replaced.
public enum MessageNavigationResult: Equatable, Sendable {
  case opened
  case unavailable
  case superseded
}

/// The newest navigation in the room it started in; a newer navigation, a room change or (where given) a Thread
/// change supersedes it.
private struct NavigationGuard {
  let request: UUID
  let generation: Int
}

/// Landing on a message in the open room: a link, a quote, a search hit or a notification. Every suspension is
/// guarded, so a navigation the reader replaced never moves the room or the Thread.
public extension OpenRoomSession {
  /// A link's target once its room is selected: waits for the room's first page, which alone decides whether the
  /// message is there (a refresh or older page may keep running), then lands on `messageId`, or just shows the
  /// room with no Thread over it.
  @discardableResult
  func openLinkTarget(roomId: String, messageId: String?) async throws -> MessageNavigationResult {
    try await holdingReads {
      let request = beginNavigation()
      let generation = room.timeline.generation
      if room.timeline.isLoading {
        _ = await room.loadTask?.value
      }
      guard isCurrent(NavigationGuard(request: request, generation: generation)), room.timeline.roomId == roomId else { return .superseded }
      guard let messageId else {
        thread.close()
        return .opened
      }
      return try await openMessage(messageId)
    }
  }

  /// Quotes and links resolve replies before choosing the existing context loader. A quote from the same room
  /// passes `marksThreadParent: false`: web's same-room quote only scrolls, while a link (a cross-room quote
  /// included) takes web's search jump, which also marks a reply's parent in the room (row 25c).
  @discardableResult
  func openMessage(_ messageId: String, marksThreadParent: Bool = true) async throws -> MessageNavigationResult {
    try await holdingReads {
      guard let roomId = room.timeline.roomId, let access = hooks.access() else { return .unavailable }
      let request = beginNavigation()
      let initialThreadGeneration = thread.transcript.timeline.generation
      let navigation = NavigationGuard(request: request, generation: room.timeline.generation)
      do {
        let message = try await navigationMessage(messageId, roomId: roomId, client: access.client, organizationSlug: access.organizationSlug)
        guard isCurrent(navigation, threadGeneration: initialThreadGeneration) else { return .superseded }
        if let message {
          // A row the transcript drops (a deleted message) can never be landed on.
          guard message.roomId == roomId, shouldKeepPersistedMessage(message) else { return .unavailable }
          if message.parentMessageId != nil {
            return try await navigateReply(message, request: request, marksParent: marksThreadParent)
          }
        }
        guard try await jumpToMessage(messageId),
              isCurrent(navigation, threadGeneration: initialThreadGeneration) else { return .superseded }
        thread.close()
        requestJump(to: messageId)
        return .opened
      } catch {
        return try currentNavigationFailure(error, navigation: navigation)
      }
    }
  }

  /// Opens the parent first, reuses its normal initial load, then fetches a context window only if the result is
  /// outside the loaded replies.
  func openMessageReply(_ hit: Components.Schemas.ChatRoomMessage) async throws -> MessageNavigationResult {
    try await holdingReads {
      try await navigateReply(hit, request: beginNavigation(), marksParent: true)
    }
  }
}

private extension OpenRoomSession {
  /// A transient lookup may recover through the context endpoint; a refusal must not.
  func navigationMessage(_ id: String, roomId: String, client: Client, organizationSlug: String?) async throws -> Components.Schemas.ChatRoomMessage? {
    if let loaded = (roomRows + replyRows).first(where: { $0.id == id }) {
      return loaded
    }
    do {
      return try await service.getMessage(client: client, roomId: roomId, messageId: id, organizationSlug: organizationSlug)
    } catch {
      if let failure = error as? ChatServiceError {
        switch failure {
        case .unauthorized: throw failure
        case let .unprocessable(status, _, _) where status == 403 || status == 404: throw failure
        default: break
        }
      }
      return nil
    }
  }

  func navigateReply(
    _ hit: Components.Schemas.ChatRoomMessage,
    request: UUID,
    marksParent: Bool
  ) async throws -> MessageNavigationResult {
    guard hit.roomId == room.timeline.roomId, let parentId = hit.parentMessageId else { return .unavailable }
    guard let access = hooks.access() else {
      throw ChatServiceError.unauthorized("Log in to view this reply.")
    }
    let initialThreadGeneration = thread.transcript.timeline.generation
    let navigation = NavigationGuard(request: request, generation: room.timeline.generation)
    do {
      let parent = try await messageParent(parentId, roomId: hit.roomId, client: access.client, organizationSlug: access.organizationSlug)
      guard isCurrent(navigation, threadGeneration: initialThreadGeneration) else { return .superseded }
      guard parent.id == parentId, parent.roomId == hit.roomId, parent.parentMessageId == nil else { return .unavailable }
      openThread(parent)
      let threadGeneration = thread.transcript.timeline.generation
      _ = await thread.transcript.loadTask?.value
      guard isCurrent(navigation, threadGeneration: threadGeneration),
            thread.parent?.id == parentId else { return .superseded }
      // Web lands the room on the parent after the reply's branch, whatever that branch found (row 25c,
      // `performRoomSearchJump`): a reply that is gone or whose window Core refused still marks it. A transport
      // failure ends web's jump in its `catch`, so only Core's answer counts here.
      let markParent = { [self] in
        if marksParent {
          markThreadParentInRoom(parentId, navigation: navigation, threadGeneration: threadGeneration)
        }
      }
      do {
        let result = try await requestReplyJump(hit, client: access.client, organizationSlug: access.organizationSlug,
                                                navigation: navigation, threadGeneration: threadGeneration)
        markParent()
        return result
      } catch let failure as ChatServiceError {
        markParent()
        throw failure
      }
    } catch {
      return try currentNavigationFailure(error, navigation: navigation, mapRefusal: false)
    }
  }

  /// The reply's half of a reply jump: its window when it is not loaded, then the Thread's jump target.
  func requestReplyJump(
    _ hit: Components.Schemas.ChatRoomMessage,
    client: Client,
    organizationSlug: String?,
    navigation: NavigationGuard,
    threadGeneration: Int
  ) async throws -> MessageNavigationResult {
    if let stopped = try await loadReplyIfNeeded(hit, client: client, organizationSlug: organizationSlug, generation: threadGeneration) {
      return stopped
    }
    guard isCurrent(navigation, threadGeneration: threadGeneration) else { return .superseded }
    // A search hit keeps its old body; the loaded row says whether the thread still shows it.
    if let loaded = thread.transcript.timeline.messages.first(where: { $0.id == hit.id }), !shouldKeepPersistedMessage(loaded) {
      return .unavailable
    }
    thread.transcript.requestJump(to: hit.id)
    return thread.transcript.jumpTarget?.messageId == hit.id ? .opened : .unavailable
  }

  /// Sends the room to the open Thread's parent, which it marks on its own clock (row 25c, web
  /// `highlightInRoom`). Only for the newest jump in the same room and Thread (web `isNewestJump`), and only when
  /// the room's loaded rows hold the parent: no window is loaded around it.
  func markThreadParentInRoom(_ parentId: String, navigation: NavigationGuard, threadGeneration: Int) {
    guard isCurrent(navigation, threadGeneration: threadGeneration), thread.parent?.id == parentId,
          room.timeline.roomId != nil, roomRows.contains(where: { $0.id == parentId }) else { return }
    requestJump(to: parentId, isThreadParent: true)
  }

  func loadReplyIfNeeded(
    _ hit: Components.Schemas.ChatRoomMessage,
    client: Client,
    organizationSlug: String?,
    generation: Int
  ) async throws -> MessageNavigationResult? {
    guard !thread.transcript.timeline.messages.contains(where: { $0.id == hit.id }) else { return nil }
    guard try await thread.transcript.timeline.loadPage(.around(hit.id), client: client, organizationSlug: organizationSlug,
                                                        generation: generation) else { return .superseded }
    return nil
  }

  func isCurrent(_ navigation: NavigationGuard, threadGeneration: Int? = nil) -> Bool {
    guard navigationRequest == navigation.request, navigation.generation == room.timeline.generation, !Task.isCancelled else { return false }
    if let threadGeneration {
      return threadGeneration == thread.transcript.timeline.generation
    }
    return true
  }

  func currentNavigationFailure(
    _ error: Error,
    navigation: NavigationGuard,
    mapRefusal: Bool = true
  ) throws -> MessageNavigationResult {
    guard isCurrent(navigation) else { return .superseded }
    if let failure = error as? ChatServiceError {
      _ = hooks.failed(failure)
      if mapRefusal, case let .unprocessable(status, _, _) = failure, status == 403 || status == 404 {
        return .unavailable
      }
    }
    throw error
  }

  func messageParent(_ id: String, roomId: String, client: Client, organizationSlug: String?) async throws -> Components.Schemas.ChatRoomMessage {
    // A parent is a top-level row: the room's history or the open Thread's parent, never a reply.
    if let parent = room.timeline.messages.first(where: { $0.id == id }) ?? thread.parent.flatMap({ $0.id == id ? $0 : nil }) {
      return parent
    }
    return try await service.getThread(client: client, roomId: roomId, parentMessageId: id, organizationSlug: organizationSlug).parentMessage
  }
}

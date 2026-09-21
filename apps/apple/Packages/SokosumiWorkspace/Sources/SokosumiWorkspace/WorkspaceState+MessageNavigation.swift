import CoreAPI
import Foundation
import SokosumiAuth
import SokosumiChat

/// Distinguishes a missing target from a jump the reader already replaced.
public enum MessageNavigationResult: Equatable, Sendable {
  case opened
  case unavailable
  case superseded
}

private struct NavigationGuard {
  let request: UUID
  let generation: Int
}

public extension WorkspaceState {
  /// Navigate to a `ChatLink.room` within the current workspace. Membership-visible rooms remain the authority;
  /// invitation and guest-join links are presented by the app instead.
  @discardableResult
  func openRoomLink(roomId: String, messageId: String?, auth: AuthState) async throws -> MessageNavigationResult {
    guard rooms.contains(where: { $0.id == roomId }) else { return .unavailable }
    selectRoom(roomId, auth: auth)
    let request = UUID()
    messageNavigationRequest = request
    let generation = timeline.generation
    await transcriptLoadTask?.value
    guard isCurrent(NavigationGuard(request: request, generation: generation)), transcriptRoomId == roomId else { return .superseded }
    guard let messageId else { thread.close()
      return .opened
    }
    return try await openMessage(messageId, auth: auth)
  }

  /// Quotes and links resolve replies before choosing the existing context loader.
  @discardableResult
  func openMessage(_ messageId: String, auth: AuthState) async throws -> MessageNavigationResult {
    guard let roomId = transcriptRoomId, let client = resolveClient(auth: auth) else { return .unavailable }
    let request = UUID()
    messageNavigationRequest = request
    let initialThreadGeneration = thread.timeline.generation
    let generation = timeline.generation
    let slug = selection?.workspace.organizationSlug
    let navigation = NavigationGuard(request: request, generation: generation)
    do {
      let message = try await navigationMessage(messageId, roomId: roomId, client: client, organizationSlug: slug)
      guard isCurrent(navigation, threadGeneration: initialThreadGeneration) else { return .superseded }
      if let message {
        // A row the transcript drops (a deleted message) can never be landed on.
        guard message.roomId == roomId, shouldKeepPersistedMessage(message) else { return .unavailable }
        if message.parentMessageId != nil {
          return try await navigateReply(message, request: request, auth: auth)
        }
      }
      guard try await jumpToMessage(messageId, auth: auth),
            isCurrent(navigation, threadGeneration: initialThreadGeneration) else { return .superseded }
      thread.close()
      messageJump = MessageJump(roomId: roomId, messageId: messageId)
      return .opened
    } catch {
      return try currentNavigationFailure(error, navigation: navigation, auth: auth)
    }
  }

  /// A transient lookup may recover through the context endpoint; a refusal must not.
  private func navigationMessage(_ id: String, roomId: String, client: Client, organizationSlug: String?) async throws -> Components.Schemas.ChatRoomMessage? {
    if let loaded = (displayedTranscript + displayedThreadReplies).first(where: { $0.id == id }) {
      return loaded
    }
    do {
      return try await ChatService().getMessage(client: client, roomId: roomId, messageId: id, organizationSlug: organizationSlug)
    } catch {
      if let failure = error as? ChatServiceError {
        switch failure {
        case .unauthorized: throw failure
        case let .unprocessable(status, _) where status == 403 || status == 404: throw failure
        default: break
        }
      }
      return nil
    }
  }

  /// Open the parent first, reuse its normal initial load, then fetch a context
  /// window only if the result is outside loaded replies. Every suspension is
  /// guarded against room/thread changes.
  func openMessageReply(_ hit: Components.Schemas.ChatRoomMessage, auth: AuthState) async throws -> MessageNavigationResult {
    let request = UUID()
    messageNavigationRequest = request
    return try await navigateReply(hit, request: request, auth: auth)
  }

  func consumeMessageJump(_ requestId: UUID) {
    if messageJump?.requestId == requestId {
      messageJump = nil
    }
  }

  private func navigateReply(_ hit: Components.Schemas.ChatRoomMessage, request: UUID, auth: AuthState) async throws -> MessageNavigationResult {
    guard hit.roomId == transcriptRoomId, let parentId = hit.parentMessageId else { return .unavailable }
    guard let client = resolveClient(auth: auth) else {
      throw ChatServiceError.unauthorized("Sign in to view this reply.")
    }
    let initialThreadGeneration = thread.timeline.generation
    let generation = timeline.generation
    let slug = selection?.workspace.organizationSlug
    let navigation = NavigationGuard(request: request, generation: generation)
    do {
      let parent = try await messageParent(parentId, roomId: hit.roomId, client: client, organizationSlug: slug)
      guard isCurrent(navigation, threadGeneration: initialThreadGeneration) else { return .superseded }
      guard parent.id == parentId, parent.roomId == hit.roomId, parent.parentMessageId == nil else { return .unavailable }
      openThread(parent, auth: auth)
      let threadGeneration = thread.timeline.generation
      await thread.loadTask?.value
      guard isCurrent(navigation, threadGeneration: threadGeneration),
            thread.parent?.id == parentId else { return .superseded }
      if let stopped = try await loadReplyIfNeeded(hit, client: client, organizationSlug: slug, generation: threadGeneration) {
        return stopped
      }
      guard isCurrent(navigation, threadGeneration: threadGeneration) else { return .superseded }
      // A search hit keeps its old body; the loaded row says whether the thread still shows it.
      if let loaded = thread.timeline.messages.first(where: { $0.id == hit.id }), !shouldKeepPersistedMessage(loaded) {
        return .unavailable
      }
      thread.requestJump(to: hit.id)
      return thread.jumpTarget?.messageId == hit.id ? .opened : .unavailable
    } catch {
      return try currentNavigationFailure(error, navigation: navigation, auth: auth, mapRefusal: false)
    }
  }

  private func loadReplyIfNeeded(
    _ hit: Components.Schemas.ChatRoomMessage,
    client: Client,
    organizationSlug: String?,
    generation: Int
  ) async throws -> MessageNavigationResult? {
    guard !thread.timeline.messages.contains(where: { $0.id == hit.id }) else { return nil }
    guard try await thread.timeline.loadPage(.around(hit.id), client: client, organizationSlug: organizationSlug,
                                             generation: generation) else { return .superseded }
    return nil
  }

  private func isCurrent(_ navigation: NavigationGuard, threadGeneration: Int? = nil) -> Bool {
    guard messageNavigationRequest == navigation.request, navigation.generation == timeline.generation, !Task.isCancelled else { return false }
    if let threadGeneration {
      return threadGeneration == thread.timeline.generation
    }
    return true
  }

  private func currentNavigationFailure(
    _ error: Error,
    navigation: NavigationGuard,
    auth: AuthState,
    mapRefusal: Bool = true
  ) throws -> MessageNavigationResult {
    guard isCurrent(navigation) else { return .superseded }
    if let failure = error as? ChatServiceError {
      signOutIfUnauthorized(failure, auth: auth)
      if mapRefusal, case let .unprocessable(status, _) = failure, status == 403 || status == 404 {
        return .unavailable
      }
    }
    throw error
  }

  private func messageParent(_ id: String, roomId: String, client: Client, organizationSlug: String?) async throws -> Components.Schemas.ChatRoomMessage {
    if let loaded = transcriptMessages.first(where: { $0.id == id }) ?? thread.parent.flatMap({ $0.id == id ? $0 : nil }) {
      return loaded
    }
    return try await ChatService().getThread(client: client, roomId: roomId, parentMessageId: id, organizationSlug: organizationSlug).parentMessage
  }
}

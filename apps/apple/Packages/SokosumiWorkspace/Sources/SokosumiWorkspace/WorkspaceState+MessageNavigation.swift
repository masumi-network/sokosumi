import CoreAPI
import Foundation
import SokosumiAuth
import SokosumiChat

public extension WorkspaceState {
  /// Navigate within the current workspace. Membership-visible rooms remain the authority.
  @discardableResult
  func openChatLink(_ link: ChatLink, auth: AuthState) async throws -> Bool {
    guard rooms.contains(where: { $0.id == link.roomId }) else { return false }
    selectRoom(link.roomId, auth: auth)
    let request = UUID()
    messageNavigationRequest = request
    let generation = timeline.generation
    await transcriptLoadTask?.value
    guard messageNavigationRequest == request, generation == timeline.generation, transcriptRoomId == link.roomId, !Task.isCancelled else { return false }
    guard let messageId = link.messageId else { thread.close()
      return true
    }
    return try await openMessage(messageId, auth: auth)
  }

  /// Quotes and links resolve replies before choosing the existing context loader.
  @discardableResult
  func openMessage(_ messageId: String, auth: AuthState) async throws -> Bool {
    guard let roomId = transcriptRoomId, let client = resolveClient(auth: auth) else { return false }
    let request = UUID()
    messageNavigationRequest = request
    let initialThreadGeneration = thread.timeline.generation
    let generation = timeline.generation
    let slug = selection?.workspace.organizationSlug
    do {
      let message: Components.Schemas.ChatRoomMessage?
      if let loaded = (displayedTranscript + displayedThreadReplies).first(where: { $0.id == messageId }) {
        message = loaded
      } else {
        do {
          message = try await ChatService().getMessage(client: client, roomId: roomId, messageId: messageId, organizationSlug: slug)
        } catch {
          if let failure = error as? ChatServiceError {
            switch failure {
            case .unauthorized: throw failure
            case let .unprocessable(status, _) where status == 403 || status == 404: return false
            default: break
            }
          }
          // Web retries a transient lookup failure through the room context endpoint.
          message = nil
        }
      }
      guard messageNavigationRequest == request, initialThreadGeneration == thread.timeline.generation,
            generation == timeline.generation, !Task.isCancelled else { return false }
      if let message {
        guard message.roomId == roomId else { return false }
        if message.parentMessageId != nil {
          return try await navigateReply(message, request: request, auth: auth)
        }
      }
      guard try await jumpToMessage(messageId, auth: auth), messageNavigationRequest == request,
            initialThreadGeneration == thread.timeline.generation, generation == timeline.generation, !Task.isCancelled else { return false }
      thread.close()
      messageJump = MessageJump(roomId: roomId, messageId: messageId)
      return true
    } catch {
      guard messageNavigationRequest == request, generation == timeline.generation, !Task.isCancelled else { return false }
      if let failure = error as? ChatServiceError {
        signOutIfUnauthorized(failure, auth: auth)
        if case let .unprocessable(status, _) = failure, status == 403 || status == 404 {
          return false
        }
      }
      throw error
    }
  }

  /// Open the parent first, reuse its normal initial load, then fetch a context
  /// window only if the result is outside loaded replies. Every suspension is
  /// guarded against room/thread changes.
  func openMessageReply(_ hit: Components.Schemas.ChatRoomMessage, auth: AuthState) async throws -> Bool {
    let request = UUID()
    messageNavigationRequest = request
    return try await navigateReply(hit, request: request, auth: auth)
  }

  func consumeMessageJump(_ requestId: UUID) {
    if messageJump?.requestId == requestId {
      messageJump = nil
    }
  }

  private func navigateReply(_ hit: Components.Schemas.ChatRoomMessage, request: UUID, auth: AuthState) async throws -> Bool {
    guard hit.roomId == transcriptRoomId, let parentId = hit.parentMessageId else { return false }
    guard let client = resolveClient(auth: auth) else {
      throw ChatServiceError.unauthorized("Sign in to view this reply.")
    }
    let initialThreadGeneration = thread.timeline.generation
    let generation = timeline.generation
    let slug = selection?.workspace.organizationSlug
    do {
      let parent = try await messageParent(parentId, roomId: hit.roomId, client: client, organizationSlug: slug)
      guard messageNavigationRequest == request, initialThreadGeneration == thread.timeline.generation,
            generation == timeline.generation, !Task.isCancelled,
            parent.id == parentId, parent.roomId == hit.roomId, parent.parentMessageId == nil else { return false }
      openThread(parent, auth: auth)
      let threadGeneration = thread.timeline.generation
      await thread.loadTask?.value
      guard messageNavigationRequest == request, generation == timeline.generation, threadGeneration == thread.timeline.generation,
            thread.parent?.id == parentId, !Task.isCancelled else { return false }
      if !thread.timeline.messages.contains(where: { $0.id == hit.id }) {
        guard try await thread.timeline.loadPage(.around(hit.id), client: client, organizationSlug: slug,
                                                 generation: threadGeneration) else { return false }
      }
      guard messageNavigationRequest == request, generation == timeline.generation, threadGeneration == thread.timeline.generation, !Task.isCancelled else { return false }
      thread.requestJump(to: hit.id)
      return thread.jumpTarget?.messageId == hit.id
    } catch {
      guard messageNavigationRequest == request, generation == timeline.generation, !Task.isCancelled else { return false }
      if let error = error as? ChatServiceError {
        signOutIfUnauthorized(error, auth: auth)
      }
      throw error
    }
  }

  private func messageParent(_ id: String, roomId: String, client: Client, organizationSlug: String?) async throws -> Components.Schemas.ChatRoomMessage {
    if let loaded = transcriptMessages.first(where: { $0.id == id }) ?? thread.parent.flatMap({ $0.id == id ? $0 : nil }) {
      return loaded
    }
    return try await ChatService().getThread(client: client, roomId: roomId, parentMessageId: id, organizationSlug: organizationSlug).parentMessage
  }
}

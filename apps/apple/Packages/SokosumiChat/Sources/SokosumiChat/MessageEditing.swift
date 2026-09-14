import Combine
import CoreAPI
import Foundation

/// One edit per window. A failed save keeps the draft; changing rooms invalidates its response.
@MainActor
public final class MessageEditing: ObservableObject {
  @Published public private(set) var source: Components.Schemas.ChatRoomMessage?
  @Published public var draft = ""
  @Published public private(set) var isSaving = false
  @Published public private(set) var errorMessage: String?
  private var generation = 0

  public init() {}

  public var content: ComposerContent {
    ComposerContent(draft)
  }

  public var canSave: Bool {
    guard let source else { return false }
    return !isSaving && content.canSend && content.text != ComposerContent(source.content).text
  }

  public func start(_ message: Components.Schemas.ChatRoomMessage, userId: String) {
    guard !isSaving, canModifyOwnMessage(message, userId: userId) else { return }
    reset()
    source = message
    draft = message.content
  }

  public func cancel() {
    guard !isSaving else { return }
    reset()
  }

  public func reset() {
    generation += 1
    source = nil
    draft = ""
    isSaving = false
    errorMessage = nil
  }

  public func save(client: Client, organizationSlug: String?) async throws -> Components.Schemas.ChatRoomMessage? {
    guard canSave, let source else { return nil }
    let attempt = generation
    let content = content.text
    isSaving = true
    errorMessage = nil
    defer {
      if attempt == generation {
        isSaving = false
      }
    }
    do {
      let updated = try await ChatService().editMessage(client: client, roomId: source.roomId, messageId: source.id,
                                                        content: content, organizationSlug: organizationSlug)
      guard attempt == generation, !Task.isCancelled else { return nil }
      reset()
      return updated
    } catch {
      guard attempt == generation else { return nil }
      isSaving = false
      errorMessage = friendlyMessage(for: error)
      throw error
    }
  }
}

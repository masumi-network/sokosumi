import CoreAPI
import Foundation
import SokosumiChat
import SokosumiWorkspace

/// What a transcript row asks its transcript to do. Whether the row offers it is `MessageRow.actions`' call.
enum MessageRowAction {
  case reply, quote, edit, togglePin, delete, retryMention
  /// Retry or remove this row's failed send.
  case retrySend, removeSend
  case toggleReaction(String)
  case removeUnfurl(String)
  case rate(useful: Bool)
  /// Scroll to a quote's source message in this room.
  case jumpToQuote(String)
  /// A project question's card id and the picked project's (row 38h1).
  case selectProject(previewId: String, projectId: String)
  /// A decision card's id and its resolution (row 38h2).
  case resolveDecision(String, SokoBotDecision.Resolution)
}

/// The jump alert's words when the message a link or quote names is gone.
let messageUnavailableText = "This message is no longer available."

/// The one answer the room and the Thread give their rows. Each transcript adds only its own outbox, where a quote
/// goes, and where a failed quote jump shows.
@MainActor
struct TranscriptRowActions {
  let workspaces: WorkspaceState
  let transcript: TranscriptSession
  let quote: (Components.Schemas.ChatRoomMessage) -> Void
  let jumpFailed: (String) -> Void

  // swiftlint:disable cyclomatic_complexity
  /// Runs a row's action. A local one (reply, quote, edit, a failed send) happens at once and returns nil; a request
  /// returns its task, which the row awaits for its busy state and failure alert.
  func perform(_ action: MessageRowAction, on message: Components.Schemas.ChatRoomMessage) -> Task<Void, any Error>? {
    switch action {
    case .reply: workspaces.openRoom.openThread(message)
    case .quote: quote(message)
    case .edit: workspaces.startEditing(message)
    case .retrySend, .removeSend:
      guard let shell = transcript.outbox.shells.first(where: { $0.id == message.id }) else { return nil }
      if case .retrySend = action {
        transcript.outbox.retry(shell.clientTurnId)
      } else {
        transcript.outbox.remove(shell.clientTurnId)
      }
    case .togglePin:
      return Task { try await workspaces.setPinned(!workspaces.isPinned(message), messageId: message.id) }
    case .delete:
      return Task { try await workspaces.deleteMessage(message) }
    case .retryMention:
      return Task { try await workspaces.retryMention(message, now: Date()) }
    case let .toggleReaction(emoji):
      return Task {
        // Match web: adding teaches quick reactions; removing does not. Taps absorbed by a running request answer
        // false, so on/off/on counts once.
        if try await workspaces.toggleReaction(message, emoji: emoji) {
          ReactionEmojiHistory().record(emoji)
        }
      }
    case let .removeUnfurl(url):
      return Task { try await workspaces.removeUnfurl(message, url: url) }
    case let .rate(useful):
      guard let turnId = SokoBotFeedback.turnId(for: message) else { return nil }
      return Task { try await workspaces.sendSokoBotFeedback(turnId: turnId, useful: useful) }
    case let .jumpToQuote(id):
      return Task {
        do {
          // A quote in this room marks no Thread parent, as web's same-room quote (row 25c).
          if try await workspaces.openMessage(id, marksThreadParent: false) == .unavailable {
            jumpFailed(messageUnavailableText)
          }
        } catch {
          jumpFailed(friendlyMessage(for: error))
        }
      }
    case let .selectProject(previewId, projectId):
      return Task { try await workspaces.selectProject(projectId, preview: previewId, question: message) }
    case let .resolveDecision(decisionId, resolution):
      return Task { try await workspaces.resolveSokoBotDecision(decisionId, resolution) }
    }
    return nil
  }
  // swiftlint:enable cyclomatic_complexity
}

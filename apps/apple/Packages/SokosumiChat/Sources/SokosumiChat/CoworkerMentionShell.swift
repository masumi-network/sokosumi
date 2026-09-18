import CoreAPI
import Foundation
import OpenAPIRuntime

/// The persisted coworker bubble Core leaves for an @mention: empty while the
/// Thought streams (`metadata.streaming` + `mention_id`) and kept after dispatch
/// failed (`mention_failed`) so "Failed to reply" and Retry can live on it.
/// Mirrors the shell helpers in web `coworker-thought.ts`; only coworker
/// senders count, like web's transcript filter.
public enum CoworkerMentionShell: Equatable, Sendable {
  /// Live Thought with no answer yet. `startedAt` comes from
  /// `thought_timing_ms.start`; nil falls back to the row's `createdAt`.
  case thinking(startedAt: Date?)
  /// Dispatch failed. Retry needs the source human message id too.
  case failed(mentionId: String, sourceMessageId: String?)

  public typealias Message = Components.Schemas.ChatRoomMessage

  public init?(message: Message) {
    guard case .case2 = message.sender, message.deletedAt == nil,
          let metadata = message.metadata?.additionalProperties,
          let mentionId = metadata["mention_id"]?.value as? String, !mentionId.isEmpty
    else { return nil }
    if metadata["mention_failed"]?.value as? Bool == true {
      let source = (metadata["in_reply_to_message_id"]?.value as? String).flatMap { $0.isEmpty ? nil : $0 }
      self = .failed(mentionId: mentionId, sourceMessageId: source)
      return
    }
    guard metadata["streaming"]?.value as? Bool == true,
          message.content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    else { return nil }
    self = .thinking(startedAt: CoworkerThought.startedAt(metadata: metadata))
  }

  public var isThinking: Bool {
    if case .thinking = self {
      return true
    }
    return false
  }

  public var startedAt: Date? {
    if case let .thinking(startedAt) = self {
      return startedAt
    }
    return nil
  }

  /// Retry is mentioner-only (web `isCurrentUserMentionerOfFailedShell`): the
  /// source message must be loaded and sent by the current user.
  public static func canRetry(_ shell: Message, currentUserId: String, sources: [Message]) -> Bool {
    guard !currentUserId.isEmpty,
          case let .failed(_, sourceMessageId?) = CoworkerMentionShell(message: shell),
          let source = sources.first(where: { $0.id == sourceMessageId }),
          case let .case1(sender) = source.sender
    else { return false }
    return sender.user.id == currentUserId
  }

  /// Flip a failed shell back to a live Thought while the retry POST is in
  /// flight, without creating a second bubble (web `withMentionShellRetrying`).
  public static func retrying(_ shell: Message, startedAt: Date) -> Message {
    var properties = shell.metadata?.additionalProperties ?? [:]
    properties["mention_failed"] = nil
    properties["streaming"] = try? OpenAPIValueContainer(unvalidatedValue: true)
    let startMilliseconds = Int((startedAt.timeIntervalSince1970 * 1000).rounded())
    properties["thought_timing_ms"] = try? OpenAPIValueContainer(unvalidatedValue: ["start": startMilliseconds])
    var updated = shell
    updated.metadata = .init(additionalProperties: properties)
    return updated
  }
}

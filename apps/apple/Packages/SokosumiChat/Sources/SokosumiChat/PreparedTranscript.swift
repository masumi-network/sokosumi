import CoreAPI
import Foundation

/// A consistent message/document snapshot prepared before lazy rows are displayed.
public struct PreparedTranscript: Sendable {
  public struct Input: Equatable, Sendable {
    public let scope: [String]
    public let messages: [Components.Schemas.ChatRoomMessage]
    public let mentions: MessageMentions?
    public let channels: [ComposerChannel]
    public let baseURL: URL

    public init(scope: [String], messages: [Components.Schemas.ChatRoomMessage], mentions: MessageMentions?, channels: [ComposerChannel], baseURL: URL) {
      self.scope = scope
      self.messages = messages
      self.mentions = mentions
      self.channels = channels
      self.baseURL = baseURL
    }
  }

  public let input: Input
  public let documents: [String: MessageMarkdown]

  /// Markdown is prepared async; chips and edits overlay that snapshot.
  /// Rows the live transcript already dropped (a deleted message) stay
  /// dropped — falling back to the snapshot would keep them on screen
  /// until re-prepare finishes.
  public func overlaying(_ live: [Components.Schemas.ChatRoomMessage]) -> [Components.Schemas.ChatRoomMessage] {
    let byId = Dictionary(live.map { ($0.id, $0) }, uniquingKeysWith: { _, latest in latest })
    return input.messages.compactMap { byId[$0.id] }
  }

  public static func prepare(_ input: Input, reusing previous: Self?) async throws -> Self {
    let task = Task.detached(priority: .userInitiated) {
      let reusable = previous.flatMap { previous in
        previous.input.scope == input.scope && previous.input.mentions == input.mentions
          && previous.input.channels == input.channels && previous.input.baseURL == input.baseURL ? previous : nil
      }
      let oldSources = Dictionary((reusable?.input.messages ?? []).map { ($0.id, $0.content) }, uniquingKeysWith: { _, latest in latest })
      var documents: [String: MessageMarkdown] = [:]
      for message in input.messages {
        try Task.checkCancellation()
        if oldSources[message.id] == message.content, let document = reusable?.documents[message.id] {
          documents[message.id] = document
        } else {
          documents[message.id] = MessageMarkdown(message.content, baseURL: input.baseURL, mentions: input.mentions, channels: input.channels)
        }
      }
      return Self(input: input, documents: documents)
    }
    return try await withTaskCancellationHandler {
      let prepared = try await task.value
      try Task.checkCancellation()
      return prepared
    } onCancel: {
      task.cancel()
    }
  }
}

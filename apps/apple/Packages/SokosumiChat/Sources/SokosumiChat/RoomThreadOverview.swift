import Combine
import CoreAPI
import Foundation

/// The selected room's thread list. Merely loading the overview never marks it read.
@MainActor
public final class RoomThreadOverview: ObservableObject {
  @Published public private(set) var items: [Components.Schemas.ChatRoomThread] = []
  @Published public private(set) var previews: [String: String] = [:]
  @Published public private(set) var nextCursor: String?
  @Published public private(set) var unreadCount = 0
  @Published public private(set) var showsUnreadCount = false
  @Published public private(set) var isLoading = false
  @Published public private(set) var isMarkingRead = false
  @Published public private(set) var failure: (any Error)?
  private var generation = 0
  private var countGeneration = 0
  private var loadGeneration = 0

  public init() {}

  public func reset() {
    generation += 1
    countGeneration += 1
    loadGeneration += 1
    items = []
    previews = [:]
    nextCursor = nil
    unreadCount = 0
    showsUnreadCount = false
    isLoading = false
    isMarkingRead = false
    failure = nil
  }

  public func refreshDisplayPreference(client: Client) async throws {
    let request = generation
    let value = try await ChatService().showRoomUnreadCount(client: client)
    guard request == generation, !Task.isCancelled else { return }
    showsUnreadCount = value
  }

  public func refreshCount(client: Client, roomId: String, organizationSlug: String?) async throws {
    countGeneration += 1
    let request = countGeneration
    let count = try await ChatService().countUnreadThreads(client: client, roomId: roomId, organizationSlug: organizationSlug)
    guard request == countGeneration, !Task.isCancelled else { return }
    unreadCount = max(0, count)
  }

  public func load(client: Client, roomId: String, organizationSlug: String?, older: Bool = false, mentions: MessageMentions? = nil) async throws {
    guard !isMarkingRead else { return }
    try await loadPage(client: client, roomId: roomId, organizationSlug: organizationSlug, older: older, mentions: mentions)
  }

  private func loadPage(client: Client, roomId: String, organizationSlug: String?, older: Bool = false, mentions: MessageMentions? = nil) async throws {
    guard !older || (!isLoading && nextCursor != nil), !Task.isCancelled else { return }
    loadGeneration += 1
    let request = loadGeneration
    let cursor = older ? nextCursor : nil
    isLoading = true
    failure = nil
    defer {
      if request == loadGeneration {
        isLoading = false
      }
    }
    do {
      let page = try await ChatService().listThreads(client: client, roomId: roomId, cursor: cursor, organizationSlug: organizationSlug)
      guard request == loadGeneration, !Task.isCancelled else { return }
      var seen = Set<String>()
      let incoming = page.items.filter { $0.parentMessage.roomId == roomId && seen.insert($0.parentMessage.id).inserted }
      let labels = await Task.detached {
        Dictionary(uniqueKeysWithValues: incoming.map { item in
          (item.parentMessage.id, Self.preview(item.parentMessage.content, mentions: mentions))
        })
      }.value
      guard request == loadGeneration, !Task.isCancelled else { return }
      if older {
        previews.merge(labels) { _, new in new }
        let known = Set(items.map(\.parentMessage.id))
        items += incoming.filter { !known.contains($0.parentMessage.id) }
      } else {
        previews = labels
        items = incoming
      }
      nextCursor = page.nextCursor == cursor ? nil : page.nextCursor
    } catch {
      guard request == loadGeneration, !Task.isCancelled else { return }
      failure = error
      throw error
    }
  }

  private nonisolated static func preview(_ content: String, mentions: MessageMentions?) -> String {
    func text(_ blocks: [MessageMarkdownBlock]) -> [String] {
      blocks.flatMap { block -> [String] in
        if case .codeBlock = block.kind {
          return []
        }
        return [String(block.text.characters)] + text(block.children)
      }
    }
    var readable = text(MessageMarkdown(content, mentions: mentions).blocks).joined(separator: " ")
    // Match web's readable thread labels: raw addresses carry no useful title.
    let addresses = try? NSRegularExpression(pattern: #"(?i)(?:(?:https?|ftps?)://|(?<![A-Za-z0-9_])www\.)[A-Za-z0-9\-._~:/?#@!$&*+,;=%\[\]]+"#)
    for match in addresses?.matches(in: readable, range: NSRange(readable.startIndex..., in: readable)).reversed() ?? [] {
      guard let range = Range(match.range, in: readable) else { continue }
      let punctuation = readable[range].reversed().prefix { ".,;:!?)]}'\"".contains($0) }.reversed()
      readable.replaceSubrange(range, with: punctuation)
    }
    readable = readable.split(whereSeparator: \.isWhitespace).joined(separator: " ")
    guard readable.unicodeScalars.count > 128 else { return readable }
    var result = ""
    var count = 0
    for character in readable {
      let size = character.unicodeScalars.count
      guard count + size <= 127 else { break }
      result.append(character)
      count += size
    }
    result = result.trimmingCharacters(in: .whitespacesAndNewlines)
    return result.isEmpty ? "" : result + "…"
  }

  public func markAllRead(client: Client, roomId: String, organizationSlug: String?, mentions: MessageMentions? = nil) async throws {
    guard !isMarkingRead, !isLoading, !Task.isCancelled else { return }
    let request = generation
    isMarkingRead = true
    failure = nil
    defer {
      if request == generation {
        isMarkingRead = false
      }
    }
    do {
      try await ChatService().markAllThreadsRead(client: client, roomId: roomId, organizationSlug: organizationSlug)
      guard request == generation, !Task.isCancelled else { return }
      countGeneration += 1
      unreadCount = 0
      try await loadPage(client: client, roomId: roomId, organizationSlug: organizationSlug, mentions: mentions)
      guard request == generation, !Task.isCancelled else { return }
      try await refreshCount(client: client, roomId: roomId, organizationSlug: organizationSlug)
    } catch {
      guard request == generation, !Task.isCancelled else { return }
      failure = error
      throw error
    }
  }
}

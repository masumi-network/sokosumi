import CoreAPI
import Foundation

/// Contiguous loaded windows, using the same edge model as web's room transcript.
/// Keep rows flat so edits, reactions and live arrivals still update one collection.
struct RoomHistoryRanges {
  private struct Key: Comparable {
    let date: Date
    let id: String

    init(_ message: Components.Schemas.ChatRoomMessage) {
      date = message.createdAt
      id = message.id
    }

    static func < (lhs: Self, rhs: Self) -> Bool {
      lhs.date == rhs.date ? lhs.id < rhs.id : lhs.date < rhs.date
    }
  }

  private var edges: [Key] = []
  private(set) var oldestCursor: String?

  func gaps(in messages: [Components.Schemas.ChatRoomMessage]) -> Set<String> {
    var edgeIndex = 0
    var result: Set<String> = []
    for (index, message) in messages.enumerated() {
      var reached = -1
      while edgeIndex < edges.count, edges[edgeIndex] <= Key(message) {
        reached = edgeIndex
        edgeIndex += 1
      }
      if reached > 0, index > 0 {
        result.insert(message.id)
      }
    }
    return result
  }

  mutating func merge(
    existing: [Components.Schemas.ChatRoomMessage],
    page: [Components.Schemas.ChatRoomMessage],
    nextCursor: String?, reachesPresent: Bool
  ) {
    let sorted = page.map(Key.init).sorted()
    guard let first = sorted.first, let last = sorted.last else {
      if reachesPresent, edges.isEmpty {
        edges = existing.first.map { [Key($0)] } ?? []
        oldestCursor = nextCursor
      }
      return
    }
    var kept: [Key] = []
    var newEdge = first
    var edgeFromPage = true
    let keys = existing.map(Key.init)
    for (index, edge) in edges.enumerated() {
      let nextEdge = index + 1 < edges.count ? edges[index + 1] : nil
      guard let newest = keys.last(where: { key in key >= edge && (nextEdge.map { key < $0 } ?? true) }) else { continue }
      guard reachesPresent || edge <= last, newest >= first else {
        kept.append(edge)
        continue
      }
      if edge < newEdge {
        newEdge = edge
        edgeFromPage = false
      }
    }
    let index = kept.firstIndex(where: { $0 > newEdge }) ?? kept.count
    kept.insert(newEdge, at: index)
    if index == 0 {
      if edgeFromPage {
        oldestCursor = nextCursor
      }
    } else if edgeFromPage, nextCursor == nil {
      kept.remove(at: index)
    }
    edges = kept
  }
}

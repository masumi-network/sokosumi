import CoreAPI
import Foundation

/// A membership-visible channel offered by the composer.
public struct ComposerChannel: Hashable, Sendable, Identifiable {
  public let id: String
  public let name: String
  public let slug: String
  public let organizationName: String?

  public init(id: String, name: String, slug: String, organizationName: String? = nil) {
    self.id = id
    self.name = name
    self.slug = slug
    self.organizationName = organizationName
  }

  /// Call with joined rooms only; discoverable rooms are not link targets.
  public static func catalog(rooms: [Components.Schemas.ChatRoom]) -> [Self] {
    rooms.compactMap { room in
      guard room.kind == .channel, let slug = room.slug, !slug.isEmpty else { return nil }
      return Self(id: room.id, name: room.name, slug: slug,
                  organizationName: room.discoverability == .external || room.myAccess == .guest ? room.organizationName : nil)
    }
  }

  /// Web stores the display name unless another channel has the same name.
  public func token(in channels: [Self]) -> String {
    let unique = channels.filter { $0.name.lowercased() == name.lowercased() }.count == 1
    return "#\(unique ? name : slug)"
  }

  public static func matching(_ channels: [Self], query: String) -> [Self] {
    let query = query.lowercased()
    let prefix = channels.filter { $0.name.lowercased().hasPrefix(query) || $0.slug.lowercased().hasPrefix(query) }
    let other = channels.filter {
      !$0.name.lowercased().hasPrefix(query) && !$0.slug.lowercased().hasPrefix(query)
        && ($0.name.lowercased().contains(query) || $0.slug.lowercased().contains(query))
    }
    return prefix + other
  }

  static func referenceRanges(in text: String, channels: [Self]) -> [(NSRange, Self)] {
    var candidates: [Int: [(NSRange, ComposerChannel)]] = [:]
    for channel in channels {
      let keys = Set([channel.name, channel.slug].map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty })
      for key in keys {
        let pattern = "(?<!\\S)#" + NSRegularExpression.escapedPattern(for: key) + "(?![\\p{L}\\p{N}_-])"
        guard let expression = try? NSRegularExpression(pattern: pattern, options: .caseInsensitive) else { continue }
        for match in expression.matches(in: text, range: NSRange(location: 0, length: text.utf16.count)) {
          candidates[match.range.location, default: []].append((match.range, channel))
        }
      }
    }
    var end = 0
    var matches: [(NSRange, ComposerChannel)] = []
    for start in candidates.keys.sorted() where start >= end {
      let entries = candidates[start] ?? []
      let longest = entries.map(\.0.length).max() ?? 0
      let best = entries.filter { $0.0.length == longest }
      guard Set(best.map(\.1.id)).count == 1, let match = best.first else { continue }
      matches.append(match)
      end = NSMaxRange(match.0)
    }
    return matches
  }
}

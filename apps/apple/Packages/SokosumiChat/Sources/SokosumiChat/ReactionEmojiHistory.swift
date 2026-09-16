import Foundation

/// Device-local picker preferences, reusable by either Apple client.
public struct ReactionEmojiHistory {
  private let defaults: UserDefaults
  private let key = "chat.reactionEmojiUseCounts"

  public init(defaults: UserDefaults = .standard) {
    self.defaults = defaults
  }

  /// The first three web defaults, matching the desktop toolbar slot count.
  public static let defaultQuickReactions: [ReactionEmoji] = ["👍", "❤️", "😂"].compactMap { emoji in
    ReactionEmoji.catalog.first { $0.emoji == emoji }
  }

  /// Preserve frequency order and fill unused slots without duplicate emoji.
  public var quickReactions: [ReactionEmoji] {
    var seen: Set<String> = []
    return Array((frequent + Self.defaultQuickReactions).filter { seen.insert($0.emoji).inserted }.prefix(3))
  }

  public var frequent: [ReactionEmoji] {
    let counts = defaults.dictionary(forKey: key) as? [String: Int] ?? [:]
    return Array(ReactionEmoji.catalog.filter { counts[$0.emoji, default: 0] > 0 }.sorted {
      let left = counts[$0.emoji, default: 0]
      let right = counts[$1.emoji, default: 0]
      return left == right ? $0.name < $1.name : left > right
    }.prefix(16))
  }

  public func record(_ emoji: String) {
    guard ReactionEmoji.catalog.contains(where: { $0.emoji == emoji }) else { return }
    var counts = defaults.dictionary(forKey: key) as? [String: Int] ?? [:]
    counts[emoji] = min(counts[emoji, default: 0], Int.max - 1) + 1
    defaults.set(counts, forKey: key)
  }
}

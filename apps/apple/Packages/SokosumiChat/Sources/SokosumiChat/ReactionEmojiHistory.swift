import Foundation

/// Device-local picker preferences, reusable by either Apple client.
public struct ReactionEmojiHistory {
  private let defaults: UserDefaults
  /// Versioned key. Existing installs used `chat.reactionEmojiUseCounts`.
  private static let key = "sokosumi.reactionEmojiUseCounts.v1"
  /// Pre-v1 key; renaming without a read would wipe picker ranking.
  private static let legacyKey = "chat.reactionEmojiUseCounts"

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
    let counts = loadCounts()
    return Array(ReactionEmoji.catalog.filter { counts[$0.emoji, default: 0] > 0 }.sorted {
      let left = counts[$0.emoji, default: 0]
      let right = counts[$1.emoji, default: 0]
      return left == right ? $0.name < $1.name : left > right
    }.prefix(16))
  }

  public func record(_ emoji: String) {
    guard ReactionEmoji.catalog.contains(where: { $0.emoji == emoji }) else { return }
    var counts = loadCounts()
    counts[emoji] = min(counts[emoji, default: 0], Int.max - 1) + 1
    saveCounts(counts)
  }

  /// One migration site: current key first, else copy and drop the leftover key.
  private func loadCounts() -> [String: Int] {
    if let current = defaults.dictionary(forKey: Self.key) as? [String: Int] {
      return current
    }
    guard let legacy = defaults.dictionary(forKey: Self.legacyKey) as? [String: Int] else {
      return [:]
    }
    saveCounts(legacy)
    return legacy
  }

  private func saveCounts(_ counts: [String: Int]) {
    defaults.set(counts, forKey: Self.key)
    defaults.removeObject(forKey: Self.legacyKey)
  }
}

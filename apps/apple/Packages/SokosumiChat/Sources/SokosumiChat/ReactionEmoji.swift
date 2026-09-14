import Foundation

/// Searchable reaction choices from the same bundled catalog as composer completion.
public struct ReactionEmoji: Identifiable, Equatable, Sendable {
  public let emoji: String
  public let name: String
  private let aliases: [String]

  public var id: String {
    emoji
  }

  public var label: String {
    name.replacingOccurrences(of: "_", with: " ")
  }

  public static let catalog: [Self] = {
    var namesByEmoji: [String: [String]] = [:]
    for name in MessageEmoji.shortcodeNames {
      if let emoji = MessageEmoji.emoji(shortcode: name) {
        namesByEmoji[emoji, default: []].append(name)
      }
    }
    return namesByEmoji.map { emoji, names in
      Self(emoji: emoji, name: names[0], aliases: names + names.flatMap { MessageEmoji.reactionKeywords[$0] ?? [] })
    }.sorted { $0.name < $1.name }
  }()

  public static func matching(_ query: String) -> [Self] {
    let query = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
      .replacingOccurrences(of: " ", with: "_")
    guard !query.isEmpty else { return catalog }
    return catalog.filter { $0.emoji == query || $0.aliases.contains { $0.contains(query) } }
  }
}

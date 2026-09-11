import CoreAPI
import Foundation

/// A roster entry and its stable wire token. Display names never replace IDs in sent text.
public struct ComposerMention: Equatable, Sendable, Identifiable {
  public enum Kind: String, Sendable {
    case human, coworker, sokoBot, all
  }

  public let id: String
  public let name: String
  public let slug: String
  public let kind: Kind
  public let image: String?

  public init(id: String, name: String, slug: String, kind: Kind, image: String? = nil) {
    self.id = id
    self.name = name
    self.slug = slug
    self.kind = kind
    self.image = image
  }

  public static func catalog(room: Components.Schemas.ChatRoom, currentUserId: String) -> [Self] {
    let bots = room.sokoBotMembers ?? []
    guard room.kind != .direct || room.userMembers.count + room.coworkerMembers.count + bots.count > 2 else { return [] }
    let humans = room.userMembers.filter { $0.id != currentUserId }.map {
      Self(id: $0.id, name: $0.name, slug: slug(for: $0.name), kind: .human, image: $0.image)
    }
    let coworkers = room.coworkerMembers.map {
      Self(id: $0.id, name: $0.name, slug: $0.slug, kind: .coworker, image: $0.image)
    }
    let assistants = bots.map {
      let normalized = slug(for: $0.name)
      return Self(id: $0.id, name: $0.name, slug: normalized.isEmpty ? $0.id : normalized, kind: .sokoBot, image: $0.image)
    }
    let everyone = humans.isEmpty ? [] : [Self(id: "all", name: "Everyone", slug: "all", kind: .all)]
    return everyone + humans + coworkers + assistants
  }

  /// Resolve both ID:slug tokens and legacy @name text as the web composer does.
  public static func selected(in text: String, catalog: [Self]) -> [Self] {
    guard let expression = try? NSRegularExpression(pattern: "@([^\\s:]+)(?::([^\\s]+))?") else { return [] }
    let source = text as NSString
    var bySlug: [String: Self] = [:]
    for entry in catalog {
      bySlug[entry.slug] = entry
    }
    var seen: Set<String> = []
    return expression.matches(in: text, range: NSRange(location: 0, length: source.length)).compactMap { match in
      let id = source.substring(with: match.range(at: 1))
      let normalized = slug(for: id)
      let tokenSlug = match.range(at: 2).location == NSNotFound ? normalized : source.substring(with: match.range(at: 2))
      guard let entry = catalog.first(where: { $0.id == id }) ?? bySlug[tokenSlug] ?? bySlug[normalized],
            seen.insert(entry.id).inserted else { return nil }
      return entry
    }
  }

  public var token: String {
    "@\(id):\(slug)"
  }

  public static func slug(for name: String) -> String {
    name.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
      .replacingOccurrences(of: "\\s+", with: "-", options: .regularExpression)
      .replacingOccurrences(of: "[^a-z0-9_-]+", with: "", options: .regularExpression)
      .replacingOccurrences(of: "-+", with: "-", options: .regularExpression)
  }

  /// Prefix matches precede substring matches; both preserve roster order, including @all.
  public static func matching(_ entries: [Self], query: String) -> [Self] {
    let query = query.lowercased()
    let prefix = entries.filter { $0.name.lowercased().hasPrefix(query) || $0.slug.lowercased().hasPrefix(query) }
    let other = entries.filter {
      !$0.name.lowercased().hasPrefix(query) && !$0.slug.lowercased().hasPrefix(query)
        && ($0.name.lowercased().contains(query) || $0.slug.lowercased().contains(query))
    }
    return prefix + other
  }
}

/// Caret-local @/# query. UTF-16 ranges match NSTextView and the web composer.
public struct ComposerReferenceTrigger: Equatable, Sendable {
  public enum Kind: Sendable {
    case mention, channel
  }

  public let kind: Kind
  public let range: NSRange
  public let query: String

  public static func match(in text: String, caret: Int) -> Self? {
    let source = text as NSString
    let caret = min(max(caret, 0), source.length)
    let prefix = source.substring(to: caret)
    guard let tokenRange = prefix.range(of: "\\S+$", options: .regularExpression) else { return nil }
    let token = String(prefix[tokenRange])
    let query = String(token.dropFirst())
    let kind: Kind
    if token.hasPrefix("@"), !query.contains("@"), !query.contains(":") {
      kind = .mention
    } else if token.hasPrefix("#"), !query.contains("#") {
      kind = .channel
    } else {
      return nil
    }
    return Self(kind: kind, range: NSRange(tokenRange, in: prefix), query: query)
  }
}

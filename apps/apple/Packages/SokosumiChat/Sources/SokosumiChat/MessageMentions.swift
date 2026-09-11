import CoreAPI
import Foundation

/// Roster resolution for rendered mentions includes the current user and small Directs.
public struct MessageMentions: Hashable, Sendable {
  private struct Entry: Hashable, Sendable {
    let id: String
    let slug: String
    let name: String
    let kind: String
  }

  private let entries: [Entry]

  public init(room: Components.Schemas.ChatRoom) {
    entries = room.coworkerMembers.map { Entry(id: $0.id, slug: $0.slug, name: $0.name, kind: "coworker") }
      + room.sokoBotMembers.map { Entry(id: $0.id, slug: ComposerMention.slug(for: $0.name), name: $0.name, kind: "sokoBot") }
      + room.userMembers.map { Entry(id: $0.id, slug: ComposerMention.slug(for: $0.name), name: $0.name, kind: "human") }
  }

  public func applying(to text: AttributedString) -> AttributedString {
    let source = String(text.characters)
    guard let expression = try? NSRegularExpression(pattern: "@([^\\s:]+)(?::([^\\s]+))?") else { return text }
    var output = text
    for match in expression.matches(in: source, range: NSRange(source.startIndex..., in: source)).reversed() {
      guard let range = Range(match.range, in: source), let attributedRange = Range(range, in: output) else { continue }
      let id = (source as NSString).substring(with: match.range(at: 1))
      let slug = match.range(at: 2).location == NSNotFound ? ComposerMention.slug(for: id) : (source as NSString).substring(with: match.range(at: 2))
      let entry = ["coworker", "sokoBot", "human"].lazy.compactMap { kind in
        entries.first { $0.kind == kind && $0.id == id } ?? entries.last { $0.kind == kind && $0.slug == slug }
      }.first
      guard id == "all" || entry != nil else { continue }
      // Formatting and existing destinations belong to the Markdown parser.
      let original = AttributedString(output[attributedRange])
      guard !original.runs.contains(where: { $0.link != nil || $0.inlinePresentationIntent?.contains(.code) == true }) else { continue }
      var replacement = AttributedString("@" + (id == "all" ? "all" : entry?.name ?? "all"))
      if let attributes = original.runs.first?.attributes {
        replacement.mergeAttributes(attributes)
      }
      replacement[MessageMentionAttribute.self] = true
      if id != "all", let entry {
        var url = URLComponents()
        url.scheme = "sokosumi-participant"
        url.host = entry.kind.lowercased()
        url.queryItems = [URLQueryItem(name: "id", value: entry.id)]
        replacement.link = url.url
      }
      output.replaceSubrange(attributedRange, with: replacement)
    }
    return output
  }
}

public enum MessageMentionAttribute: AttributedStringKey {
  public typealias Value = Bool
  public static let name = "sokosumi.message.mention"
}

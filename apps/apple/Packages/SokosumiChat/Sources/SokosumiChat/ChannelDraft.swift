import Foundation

public struct ChannelDraft: Equatable, Sendable {
  public enum Visibility: String, CaseIterable, Sendable {
    case `public`, `private`, external
  }

  /// Core's channel limits (`name` and `topic` `.max(80)` / `.max(200)`, the sanitized slug 80), counted as web and zod count: UTF-16 units.
  public static let nameLimit = 80
  public static let topicLimit = 200
  public static let slugLimit = 80

  public private(set) var slug = ""
  public private(set) var name = ""
  public private(set) var topic = ""
  public private(set) var slugEdited = false
  public private(set) var nameEdited = false
  public var visibility: Visibility = .public
  public var addAllMembers = true
  public var recipients: Set<DirectRecipient> = []

  public init() {}

  var canonicalSlug: String {
    slug.trimmingCharacters(in: CharacterSet(charactersIn: "-"))
  }

  public var isValid: Bool {
    !canonicalSlug.isEmpty && !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
  }

  /// Web's `remainingNameChars`: the counter beside the name field, 0 once the field is full.
  public var remainingNameCharacters: Int {
    Self.nameLimit - name.utf16.count
  }

  /// Web's `remainingTopicChars`.
  public var remainingTopicCharacters: Int {
    Self.topicLimit - topic.utf16.count
  }

  public mutating func setSlug(_ raw: String) {
    let normalized = raw.lowercased().decomposedStringWithCompatibilityMapping
      .replacingOccurrences(of: "[\\u0300-\\u036f]", with: "", options: .regularExpression)
      .replacingOccurrences(of: " ", with: "-")
      .replacingOccurrences(of: "[^a-z0-9-]+", with: "", options: .regularExpression)
      .replacingOccurrences(of: "-+", with: "-", options: .regularExpression)
      .replacingOccurrences(of: "^-+", with: "", options: .regularExpression)
    slug = String(normalized.prefix(Self.slugLimit))
    slugEdited = true
    if !nameEdited {
      name = slug.split(separator: "-").map { $0.prefix(1).uppercased() + $0.dropFirst() }.joined(separator: " ")
    }
  }

  public mutating func setName(_ raw: String) {
    name = Self.limit(raw.replacingOccurrences(of: "^#+", with: "", options: .regularExpression), to: Self.nameLimit)
    nameEdited = true
  }

  public mutating func setTopic(_ raw: String) {
    topic = Self.limit(raw, to: Self.topicLimit)
  }

  func selectedRecipients(roster: ChatRecipientRoster, currentUserId: String) -> [DirectRecipient] {
    let selected = roster.targets.filter { target in
      if addAllMembers, case .human = target.id {
        return true
      }
      return !addAllMembers && recipients.contains(target.id)
    }.map(\.id)
    return [.human(currentUserId)] + selected.filter { $0 != .human(currentUserId) }
  }

  static func limit(_ raw: String, to maximum: Int) -> String {
    var length = 0
    return String(raw.prefix { character in
      length += character.utf16.count
      return length <= maximum
    })
  }
}

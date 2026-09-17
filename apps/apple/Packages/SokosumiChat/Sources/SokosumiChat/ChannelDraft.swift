import Foundation

public struct ChannelDraft: Equatable, Sendable {
  public enum Visibility: String, CaseIterable, Sendable {
    case `public`, `private`, external
  }

  public private(set) var slug = ""
  public private(set) var name = ""
  public private(set) var topic = ""
  public private(set) var nameEdited = false
  public var visibility: Visibility = .public
  public var addAllMembers = true
  public var recipients: Set<DirectRecipient> = []

  public init() {}

  public var canonicalSlug: String {
    slug.trimmingCharacters(in: CharacterSet(charactersIn: "-"))
  }

  public var isValid: Bool {
    !canonicalSlug.isEmpty && !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
  }

  public mutating func setSlug(_ raw: String) {
    let normalized = raw.lowercased().decomposedStringWithCompatibilityMapping
      .replacingOccurrences(of: "[\\u0300-\\u036f]", with: "", options: .regularExpression)
      .replacingOccurrences(of: " ", with: "-")
      .replacingOccurrences(of: "[^a-z0-9-]+", with: "", options: .regularExpression)
      .replacingOccurrences(of: "-+", with: "-", options: .regularExpression)
      .replacingOccurrences(of: "^-+", with: "", options: .regularExpression)
    slug = String(normalized.prefix(80))
    if !nameEdited {
      name = slug.split(separator: "-").map { $0.prefix(1).uppercased() + $0.dropFirst() }.joined(separator: " ")
    }
  }

  public mutating func setName(_ raw: String) {
    name = Self.limit(raw.replacingOccurrences(of: "^#+", with: "", options: .regularExpression), to: 80)
    nameEdited = true
  }

  public mutating func setTopic(_ raw: String) {
    topic = Self.limit(raw, to: 200)
  }

  public func selectedRecipients(roster: ChatRecipientRoster, currentUserId: String) -> [DirectRecipient] {
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

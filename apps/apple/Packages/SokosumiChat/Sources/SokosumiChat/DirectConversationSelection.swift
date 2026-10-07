import Foundation

/// Recipient selection shared by the native Direct picker and its request validation.
public struct DirectConversationSelection: Equatable, Sendable {
  public private(set) var recipients: [DirectRecipient] = []
  public let hasOrganization: Bool
  /// The reader: `.human(currentUserId)` is Message yourself.
  public let currentUserId: String

  public init(hasOrganization: Bool, currentUserId: String) {
    self.hasOrganization = hasOrganization
    self.currentUserId = currentUserId
  }

  private var yourself: DirectRecipient {
    .human(currentUserId)
  }

  /// Message yourself is chosen, so the request opens the reader's Self Direct.
  public var isSelfDirect: Bool {
    recipients == [yourself]
  }

  public func disabledReason(for recipient: DirectRecipient) -> String? {
    guard !recipients.contains(recipient), let first = recipients.first else { return nil }
    // Web `isTargetDisabled`: Message yourself takes no one else and is unavailable once anyone else is chosen.
    if first == yourself || recipient == yourself {
      return "Self-chat cannot include other recipients."
    }
    switch (first, recipient) {
    case (.human, .human):
      return hasOrganization ? nil : "Select an organization to start a group Direct."
    case (.human, _):
      return "Group Directs can only include people."
    case (.coworker, .coworker), (.sokoBot, .sokoBot):
      return nil
    case (.coworker, _):
      return "Coworker Directs are one-to-one."
    case (.sokoBot, _):
      return "Personal assistant Directs are one-to-one."
    }
  }

  public mutating func add(_ recipient: DirectRecipient) {
    guard disabledReason(for: recipient) == nil, !recipients.contains(recipient) else { return }
    switch recipient {
    case .human where recipient != yourself: recipients.append(recipient)
    case .human, .coworker, .sokoBot: recipients = [recipient]
    }
  }

  public mutating func remove(_ recipient: DirectRecipient) {
    recipients.removeAll { $0 == recipient }
  }
}

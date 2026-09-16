import Foundation

/// Recipient selection shared by the native Direct picker and its request validation.
public struct DirectConversationSelection: Equatable, Sendable {
  public private(set) var recipients: [DirectRecipient] = []
  public let hasOrganization: Bool

  public init(hasOrganization: Bool) {
    self.hasOrganization = hasOrganization
  }

  public func disabledReason(for recipient: DirectRecipient) -> String? {
    guard !recipients.contains(recipient), let first = recipients.first else { return nil }
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
    case .human: recipients.append(recipient)
    case .coworker, .sokoBot: recipients = [recipient]
    }
  }

  public mutating func remove(_ recipient: DirectRecipient) {
    recipients.removeAll { $0 == recipient }
  }
}

import Foundation

/// Web's toasts after a members-panel change (SOK-1258, `room-members-panel.tsx`, `add-room-members-dialog.tsx`).
/// A Coworker or Soko Bot goes without a confirm, so its notice offers Undo and stays until closed; a person was
/// confirmed first and putting a Guest back takes a new invite, so theirs only reports and times out.
public struct ChannelMembershipNotice: Equatable, Sendable {
  public let message: String
  /// Who Undo adds back.
  public let undo: DirectRecipient?

  public var staysUntilClosed: Bool {
    undo != nil
  }

  public static func removed(_ member: DirectRecipient, name: String) -> Self {
    let undo: DirectRecipient? = if case .human = member {
      nil
    } else {
      member
    }
    return .init(message: "Removed \(name) from the channel.", undo: undo)
  }

  public static func added(count: Int) -> Self {
    .init(message: count == 1 ? "Added 1 member." : "Added \(count) members.", undo: nil)
  }
}

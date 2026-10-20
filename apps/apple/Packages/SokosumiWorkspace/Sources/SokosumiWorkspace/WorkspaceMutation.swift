import SokosumiChat

/// A Channel, Direct or invitation change. One runs at a time across the workspace, matching web's one open dialog.
public enum WorkspaceMutation: Equatable, Sendable {
  case createChannel
  case joinChannel
  /// A settings, Group name or member change to a listed room.
  case updateRoom
  case openDirect(DirectRecipient)
  case channelLifecycle(ChannelLifecycleAction, roomId: String)
  /// Accepting or declining an invitation; a guest invite link's `id` is its token.
  case respondToInvitation(InvitationAction, id: String)

  /// The room a leave, archive, restore or delete runs for.
  public var lifecycleRoomId: String? {
    if case let .channelLifecycle(_, roomId) = self {
      roomId
    } else {
      nil
    }
  }

  /// The response running for invitation `id`, like web's single `respondingInvitation` across the External rows.
  public func response(to id: String) -> InvitationAction? {
    if case let .respondToInvitation(action, responding) = self, responding == id {
      action
    } else {
      nil
    }
  }
}

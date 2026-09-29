import CoreAPI
import SokosumiAuth
import SokosumiChat

/// The sidebar's Unreads filter (row 24f2, web's `ChatUnreadNavRows` and `OrganizationChatList`).
public extension WorkspaceState {
  /// What the filter lists, or nil while it is off. The open room is the one the detail column shows: behind the
  /// Threads view none is (web's highlight is on `/chat/threads` then).
  var unreadsFilter: UnreadsFilterList? {
    sidebar.unreadsFilter(
      activeRoomId: sidebar.showsThreadsView ? nil : selectedRoomId,
      hasPendingInvitation: !pendingInvitations.invitations.isEmpty
    )
  }

  /// The View menu's Mark All as Read (SOK-1201): offered under the sidebar row's rule, to a signed-in reader, and
  /// not again while one runs.
  func offersMarkAllUnreadRead(isSignedIn: Bool) -> Bool {
    isSignedIn && unreadsFilter?.showsMarkAll == true && !sidebar.isMarkingAllUnreadRead
  }

  /// Web's Mark all as read: every room's reads at once, then the rooms again, whatever the outcome.
  func markAllUnreadRead(auth: AuthState) async {
    guard let client = resolveClient(auth: auth) else { return }
    let context = compositionContext
    do {
      guard try await sidebar.markAllUnreadRead(client: client, organizationSlug: selection?.workspace.organizationSlug) else { return }
    } catch {
      if let error = error as? ChatServiceError {
        signOutIfUnauthorized(error, auth: auth)
      }
    }
    // What Core holds now, part-read or not, is what the rooms show next. A list already in flight predates it.
    guard context == compositionContext else { return }
    await roomsRefreshTask?.value
    await refreshRooms(auth: auth)
  }
}

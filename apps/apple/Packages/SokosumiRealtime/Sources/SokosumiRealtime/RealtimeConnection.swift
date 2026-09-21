import Foundation
import SokosumiChat

/// Room + control subscription over one Ably connection (SOK-976).
///
/// The app owns one connection while signed in; `WorkspaceState` drives it
/// (connect after rooms load, observe the open room, refresh membership,
/// enter org presence, disconnect on sign-out). ably-cocoa backs the real
/// thing; tests inject a fake. No push (ADR 0022 / 0023).
///
/// All closures are `Sendable`: the provider closes over the `OAuthSession`
/// actor (actors cross isolation) plus values, never over MainActor state.
/// The workspace slug rides as a provider parameter because it changes on
/// switch while the provider itself is installed once at connect.
public typealias RealtimeTokenProvider = @Sendable (String?) async throws -> AblyTokenFields
public typealias RealtimeEventHandler = @Sendable (ResolvedRealtimeDelivery) -> Void

public protocol RealtimeConnection: AnyObject, Sendable {
  /// Opens the socket (token via provider) and subscribes the chat-control
  /// channel for `userId`. Room watching starts with `watchRoom`.
  func connect(
    userId: String,
    organizationSlug: String?,
    tokenProvider: @escaping RealtimeTokenProvider,
    onEvent: @escaping RealtimeEventHandler
  )
  /// Retargets future token mints (workspace switch). Does not remint.
  func setOrganizationSlug(_ slug: String?)
  /// Observes the selected room health. Nil removes that observation.
  func watchRoom(_ roomId: String?)
  func setMembershipRooms(_ roomIds: Set<String>)
  func refreshMembership()
  /// Enters org presence for the active organization once its token grant is
  /// confirmed, leaving any previous one; nil (personal) only leaves (ADR 0003).
  func setPresenceOrganization(_ organizationId: String?)
  /// Latest presence data for this client. The coordinator throttles; the
  /// transport re-sends it after every (re)authorization.
  func publishPresence(_ data: ChatPresenceMemberData)
  /// Whether the app is in front of the reader. Enters presence on the
  /// notifications channel while it is and leaves when it goes behind, so
  /// Core can hold a notification email back for a reader who is looking
  /// (SOK-1090). Kept until the channel exists, which is after connect.
  func setInFront(_ inFront: Bool)
  func disconnect()
}

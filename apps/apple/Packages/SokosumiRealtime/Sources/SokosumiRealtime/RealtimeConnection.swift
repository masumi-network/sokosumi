import Foundation

/// Room + control subscription over one Ably connection (SOK-976).
///
/// The app owns one connection while signed in; `WorkspaceState` drives it
/// (connect after rooms load, watch the open room, reauthorize on remint,
/// disconnect on sign-out). ably-cocoa backs the real thing; tests inject a
/// fake. No presence enter (ADR 0003), no push (ADR 0022 / 0023).
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
  /// Switches the room channel subscription. Nil detaches (room closed).
  func watchRoom(_ roomId: String?)
  /// Forces a token remint with the TokenRequest Core just issued, so Ably
  /// does not call `authCallback` again (one Core POST per remint).
  func reauthorize(token: AblyTokenFields)
  func disconnect()
}

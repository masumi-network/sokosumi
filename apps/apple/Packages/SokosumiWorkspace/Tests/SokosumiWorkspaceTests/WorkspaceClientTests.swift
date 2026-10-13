import Foundation
import SokosumiAuth
import SokosumiChat
@testable import SokosumiWorkspace
import Testing

struct WorkspaceClientTests {
  /// The read cooldown waits before the bearer resolves its token, so the order is part of the contract.
  @Test func workspaceRequestsRunThroughTheStackInOrder() throws {
    let configuration = try OAuthConfiguration(issuerBaseURL: #require(URL(string: "https://app.sokosumi.com")), clientID: "client")
    let auth = AuthState(configuration: configuration, store: InMemoryTokenStore(), browser: StubOAuthBrowser(), restoreSession: false)
    let session = try #require(auth.oauthSession)
    let stack = workspaceMiddlewares(session: session, cooldown: ChatReadCooldown(), build: "7").map { String(describing: type(of: $0)) }
    #expect(stack == ["ChatReadCooldownMiddleware", "BearerAuthMiddleware", "ClientBuildMiddleware", "GuestInviteLinkExpiryMiddleware"])
  }
}

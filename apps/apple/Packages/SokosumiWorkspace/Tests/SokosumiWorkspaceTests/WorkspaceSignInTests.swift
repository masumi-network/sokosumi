import Foundation
@testable import SokosumiAuth
import SokosumiWorkspace
import Testing

/// Answers the authorize page with Core's callback, carrying the page's state.
@MainActor
private final class CallbackBrowser: OAuthBrowser {
  func authenticate(url: URL) async throws -> URL {
    let state = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "state" }?.value
    var callback = URLComponents()
    callback.scheme = "https"
    callback.host = OAuthConfiguration.callbackHost
    callback.path = OAuthConfiguration.callbackPath
    callback.queryItems = [URLQueryItem(name: "code", value: "code"), URLQueryItem(name: "state", value: state)]
    return try #require(callback.url)
  }

  func cancel() {}
}

private struct TokenEndpoint: TokenEndpointTransport {
  func postForm(_: [(name: String, value: String)], to _: URL) async throws -> (Data, Int) {
    (Data(#"{"access_token":"access","refresh_token":"refresh","expires_in":7200}"#.utf8), 200)
  }
}

/// The workspace follows sign-in itself, once for all windows. Every start or reset renews `compositionContext`
/// first, before a load looks for a client, so the context shows which ran.
@MainActor
struct WorkspaceSignInTests {
  private func auth(restoring: Bool) throws -> AuthState {
    let store = InMemoryTokenStore()
    if restoring {
      try store.save(OAuthTokens(accessToken: "access", refreshToken: "refresh", expiresAt: .distantFuture))
    }
    let configuration = try OAuthConfiguration(issuerBaseURL: #require(URL(string: "https://app.sokosumi.com")), clientID: "client")
    return AuthState(configuration: configuration, store: store, browser: CallbackBrowser(), transport: TokenEndpoint())
  }

  private func waitForNewContext(_ state: WorkspaceState, after context: UUID) async {
    for _ in 0 ..< 100 where state.compositionContext == context {
      await Task.yield()
    }
  }

  @Test func aRestoredSessionWaitsForAWindowToStart() async throws {
    let auth = try auth(restoring: true)
    #expect(auth.isSignedIn)
    let state = WorkspaceState(auth: auth)
    let context = state.compositionContext
    await waitForNewContext(state, after: context)
    #expect(state.compositionContext == context, "Launch starts nothing; a window's loading view does.")
  }

  @Test func signingInStartsAndSigningOutResetsSoTheNextSignInStartsAgain() async throws {
    let auth = try auth(restoring: false)
    let state = WorkspaceState(auth: auth)
    let launched = state.compositionContext
    await auth.startSignIn()?.value
    #expect(auth.isSignedIn)
    await waitForNewContext(state, after: launched)
    #expect(state.compositionContext != launched, "Signing in started the workspace.")

    let signedIn = state.compositionContext
    await auth.signOut().value
    await waitForNewContext(state, after: signedIn)
    #expect(state.compositionContext != signedIn, "Signing out reset the workspace.")

    let signedOut = state.compositionContext
    await auth.startSignIn()?.value
    await waitForNewContext(state, after: signedOut)
    #expect(state.compositionContext != signedOut, "The reset cleared the loaded flag, so the next sign-in starts again.")
  }
}

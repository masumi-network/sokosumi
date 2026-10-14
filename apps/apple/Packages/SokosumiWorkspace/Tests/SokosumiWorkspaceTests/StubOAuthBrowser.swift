import Foundation
import SokosumiAuth

@MainActor
final class StubOAuthBrowser: OAuthBrowser {
  func authenticate(url _: URL) async throws -> URL {
    throw OAuthBrowserError.couldNotStart
  }

  func cancel() {}
}

/// A session nothing restores, for a workspace whose test never signs in.
@MainActor
func signedOutAuth() -> AuthState {
  AuthState(configuration: nil, store: InMemoryTokenStore(), browser: StubOAuthBrowser(), restoreSession: false)
}

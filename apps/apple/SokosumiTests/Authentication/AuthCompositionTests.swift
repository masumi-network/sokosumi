import Foundation
@testable import Sokosumi
import SokosumiAuth
import Testing

/// Counts `load()` calls: proves `AuthState.init` never reads the store
/// under a test runner (the host app must not touch the login Keychain —
/// a fresh ad-hoc signature pops a system prompt on every test launch).
private final class LoadCountingStore: TokenStore, @unchecked Sendable {
  var tokens: OAuthTokens?
  private(set) var loadCalls = 0
  func load() -> OAuthTokens? {
    loadCalls += 1
    return tokens
  }

  func save(_: OAuthTokens) throws {}
  func clear() -> Bool {
    true
  }
}

struct AuthCompositionTests {
  @Test func authInitSkipsTokenStoreRestoreUnderTestRunner() {
    let store = LoadCountingStore()
    store.tokens = OAuthTokens(accessToken: "stored", refreshToken: nil, expiresAt: Date(), scope: nil)
    _ = AuthState(store: store)
    #expect(store.loadCalls == 0)
  }
}

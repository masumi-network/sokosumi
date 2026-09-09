import Foundation
import SokosumiAuth
import Testing

@MainActor
private final class TestBrowser: OAuthBrowser {
  var error: (any Error)?
  var pending: CheckedContinuation<URL, any Error>?
  var openedURL: URL?
  private var started: CheckedContinuation<Void, Never>?

  func authenticate(url: URL) async throws -> URL {
    openedURL = url
    if let error {
      throw error
    }
    return try await withCheckedThrowingContinuation { continuation in
      pending = continuation
      started?.resume()
      started = nil
    }
  }

  func waitUntilStarted() async {
    if pending != nil {
      return
    }
    await withCheckedContinuation { started = $0 }
  }

  func complete(state: String? = nil) throws {
    let url = try #require(openedURL)
    let query = try #require(URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems)
    let expectedState = try #require(query.first { $0.name == "state" }?.value)
    let callback = try #require(URL(string: "com.sokosumi.app:/auth?code=c&state=\(state ?? expectedState)"))
    pending?.resume(returning: callback)
    pending = nil
  }

  func cancel() {
    pending?.resume(throwing: OAuthBrowserError.cancelled)
    pending = nil
  }
}

@MainActor
struct AuthStateTests {
  private func makeState(
    store: any TokenStore = InMemoryTokenStore(),
    browser: TestBrowser,
    transport: any TokenEndpointTransport = StubTokenTransport(response: .success(
      status: 200,
      json: #"{"access_token":"access","refresh_token":"refresh","expires_in":7200}"#
    )),
    restoreSession: Bool = true
  ) throws -> AuthState {
    try AuthState(
      configuration: OAuthConfiguration(
        issuerBaseURL: #require(URL(string: "https://core.example/auth")), clientID: "test-client"
      ),
      store: store, browser: browser, transport: transport, restoreSession: restoreSession
    )
  }

  @Test func restoreUsesStoredSessionWithoutOpeningBrowser() throws {
    let store = InMemoryTokenStore()
    try store.save(OAuthTokens(accessToken: "expired", refreshToken: "refresh", expiresAt: .distantPast, scope: nil))
    let browser = TestBrowser()
    let state = try makeState(store: store, browser: browser)
    #expect(state.isSignedIn)
    #expect(browser.openedURL == nil)
    let testHostState = try makeState(store: store, browser: browser, restoreSession: false)
    #expect(testHostState.status == .signedOut(message: nil))
  }

  @Test func missingConfigurationCannotOpenBrowser() {
    let browser = TestBrowser()
    let state = AuthState(configuration: nil, store: InMemoryTokenStore(), browser: browser)
    #expect(state.status == .notConfigured)
    #expect(state.startSignIn() == nil)
    #expect(state.oauthSession == nil)
    #expect(browser.openedURL == nil)
  }

  @Test func browserCallbackPersistsSessionAndSignsIn() async throws {
    let store = InMemoryTokenStore()
    let browser = TestBrowser()
    let state = try makeState(store: store, browser: browser)
    let operation = try #require(state.startSignIn())
    #expect(state.status == .signingIn)
    await browser.waitUntilStarted()
    try browser.complete()
    await operation.value
    #expect(state.isSignedIn)
    #expect(store.load()?.accessToken == "access")
    await state.signOut().value
    #expect(state.status == .signedOut(message: nil))
    #expect(store.load() == nil)
  }

  @Test func cancellationLeavesSignedOutAndAllowsRetry() async throws {
    let browser = TestBrowser()
    let state = try makeState(browser: browser)
    let first = try #require(state.startSignIn())
    await browser.waitUntilStarted()
    await state.cancelSignIn()?.value
    await first.value
    #expect(state.status == .signedOut(message: nil))
    let retry = try #require(state.startSignIn())
    await browser.waitUntilStarted()
    try browser.complete()
    await retry.value
    #expect(state.isSignedIn)
  }

  @Test func immediateCancellationDoesNotOpenBrowser() async throws {
    let browser = TestBrowser()
    let state = try makeState(browser: browser)
    let operation = try #require(state.startSignIn())
    await state.cancelSignIn()?.value
    await operation.value
    #expect(browser.openedURL == nil)
    #expect(state.status == .signedOut(message: nil))
  }

  @Test(arguments: [OAuthBrowserError.couldNotStart, .missingCallback])
  func browserFailuresAreVisible(error: OAuthBrowserError) async throws {
    let browser = TestBrowser()
    browser.error = error
    let state = try makeState(browser: browser)
    await state.startSignIn()?.value
    guard case let .signedOut(message) = state.status else {
      Issue.record("Expected sign-in failure")
      return
    }
    #expect(message?.isEmpty == false)
  }

  @Test func wrongCallbackStateDoesNotPersistTokens() async throws {
    let browser = TestBrowser()
    let store = InMemoryTokenStore()
    let state = try makeState(store: store, browser: browser)
    let operation = try #require(state.startSignIn())
    await browser.waitUntilStarted()
    try browser.complete(state: "wrong-state")
    await operation.value
    #expect(state.status == .signedOut(message: "Sign-in was interrupted. Try again."))
    #expect(store.load() == nil)
  }

  @Test func offlineExchangeIsVisibleAndRetryable() async throws {
    let browser = TestBrowser()
    let transport = StubTokenTransport(response: .failure(URLError(.notConnectedToInternet)))
    let state = try makeState(browser: browser, transport: transport)
    let operation = try #require(state.startSignIn())
    await browser.waitUntilStarted()
    try browser.complete()
    await operation.value
    #expect(state.status == .signedOut(message: "No network connection. Check your connection and try again."))
  }

  @Test func persistenceFailureDoesNotClaimSignedIn() async throws {
    let browser = TestBrowser()
    let store = InMemoryTokenStore()
    store.saveError = TokenStoreError.writeFailed
    let state = try makeState(store: store, browser: browser)
    let operation = try #require(state.startSignIn())
    await browser.waitUntilStarted()
    try browser.complete()
    await operation.value
    #expect(!state.isSignedIn)
    #expect(state.status == .signedOut(message: "Signed in, but your session could not be saved on this device. Try again."))
  }

  @Test func failedSignOutDoesNotClaimTokensAreGone() async throws {
    let store = FailingClearStore()
    store.save(OAuthTokens(accessToken: "access", refreshToken: "refresh", expiresAt: .distantFuture, scope: nil))
    let state = try makeState(store: store, browser: TestBrowser())
    await state.signOut().value
    #expect(state.isSignedIn)
    #expect(state.signOutError != nil)
    #expect(store.load() != nil)
  }

  @Test func cancelledExchangeCannotSignInOverNewAttempt() async throws {
    let store = InMemoryTokenStore()
    let browser = TestBrowser()
    let transport = SuspendedTokenTransport()
    let state = try makeState(store: store, browser: browser, transport: transport)
    let old = try #require(state.startSignIn())
    await browser.waitUntilStarted()
    try browser.complete()
    await transport.waitUntilStarted()
    await state.cancelSignIn()?.value
    let next = try #require(state.startSignIn())
    await browser.waitUntilStarted()
    await transport.finish()
    await old.value
    #expect(state.status == .signingIn)
    #expect(store.load() == nil)
    await state.cancelSignIn()?.value
    await next.value
  }
}

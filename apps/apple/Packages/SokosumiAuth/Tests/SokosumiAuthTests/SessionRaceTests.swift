import Foundation
import SokosumiAuth
import Testing

/// Holds the token response even when cancelled, like a response already
/// delivered by URLSession while sign-out is being processed.
actor SuspendedTokenTransport: TokenEndpointTransport {
  private var responses: [CheckedContinuation<(Data, Int), any Error>] = []
  private(set) var requestCount = 0
  private var finished = false
  private var started: CheckedContinuation<Void, Never>?
  private var didStart = false

  func postForm(_: [(name: String, value: String)], to _: URL) async throws -> (Data, Int) {
    requestCount += 1
    if finished {
      return reply
    }
    return try await withCheckedThrowingContinuation { continuation in
      responses.append(continuation)
      didStart = true
      started?.resume()
      started = nil
    }
  }

  func waitUntilStarted() async {
    if didStart {
      return
    }
    await withCheckedContinuation { started = $0 }
  }

  private var reply: (Data, Int) {
    (Data(#"{"access_token":"late-access","refresh_token":"late-refresh","expires_in":7200}"#.utf8), 200)
  }

  func finish() {
    finished = true
    for response in responses {
      response.resume(returning: reply)
    }
    responses = []
  }
}

struct SessionRaceTests {
  private func session(store: any TokenStore, transport: any TokenEndpointTransport) throws -> OAuthSession {
    try OAuthSession(
      configuration: OAuthConfiguration(
        issuerBaseURL: #require(URL(string: "https://core.example/auth")),
        clientID: "test-client"
      ),
      store: store,
      transport: transport
    )
  }

  @Test func signOutDuringExchangeCannotRestoreTokens() async throws {
    let store = InMemoryTokenStore()
    let transport = SuspendedTokenTransport()
    let session = try session(store: store, transport: transport)
    let task = Task {
      try await session.signIn(
        callbackURL: #require(URL(string: "com.sokosumi.app:/auth?code=c&state=s")),
        expectedState: "s", codeVerifier: "v"
      )
    }
    await transport.waitUntilStarted()
    #expect(await session.signOut())
    await transport.finish()
    await #expect(throws: CancellationError.self) { try await task.value }
    #expect(store.load() == nil)
  }

  @Test func signOutDuringRefreshCannotRestoreTokens() async throws {
    let store = InMemoryTokenStore()
    try store.save(OAuthTokens(accessToken: "expired", refreshToken: "refresh", expiresAt: .distantPast, scope: nil))
    let transport = SuspendedTokenTransport()
    let session = try session(store: store, transport: transport)
    let task = Task { try await session.validAccessToken() }
    await transport.waitUntilStarted()
    #expect(await session.signOut())
    await transport.finish()
    await #expect(throws: CancellationError.self) { try await task.value }
    #expect(store.load() == nil)
  }

  @Test func concurrentRequestsShareOneRefresh() async throws {
    let store = InMemoryTokenStore()
    try store.save(OAuthTokens(accessToken: "expired", refreshToken: "refresh", expiresAt: .distantPast, scope: nil))
    let transport = SuspendedTokenTransport()
    let session = try session(store: store, transport: transport)
    let requests = (0 ..< 20).map { _ in Task { try await session.validAccessToken() } }
    await transport.waitUntilStarted()
    await transport.finish()
    for request in requests {
      #expect(try await request.value == "late-access")
    }
    #expect(await transport.requestCount == 1)
  }
}

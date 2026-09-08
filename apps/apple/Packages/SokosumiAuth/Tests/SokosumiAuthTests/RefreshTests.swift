import Foundation
import SokosumiAuth
import Testing

final class TestClock: @unchecked Sendable {
  var now = Date(timeIntervalSince1970: 1_786_000_000)
}

struct RefreshTests {
  private func configuration() throws -> OAuthConfiguration {
    try OAuthConfiguration(
      issuerBaseURL: #require(URL(string: "https://core.example/auth")),
      clientID: "mac-public-client"
    )
  }

  private func signIn(
    session: OAuthSession,
    transport: StubTokenTransport,
    accessToken: String = "access-1",
    refreshToken: String? = "refresh-1",
    expiresIn: TimeInterval = 7200
  ) async throws {
    var json = "{\"access_token\":\"\(accessToken)\",\"token_type\":\"Bearer\",\"expires_in\":\(Int(expiresIn))"
    if let refreshToken {
      json += ",\"refresh_token\":\"\(refreshToken)\""
    }
    json += "}"
    transport.response = .success(status: 200, json: json)
    try await session.signIn(
      callbackURL: #require(URL(string: "com.sokosumi.app:/auth?code=c&state=s")),
      expectedState: "s",
      codeVerifier: "v"
    )
  }

  @Test func validAccessTokenUsesCacheWithoutNetwork() async throws {
    let transport = StubTokenTransport(response: .failure(UnreachableError()))
    let clock = TestClock()
    let session = try OAuthSession(
      configuration: configuration(),
      store: InMemoryTokenStore(),
      transport: transport,
      now: { clock.now }
    )
    try await signIn(session: session, transport: transport)
    transport.response = .failure(UnreachableError())

    let token = try await session.validAccessToken()
    #expect(token == "access-1")
  }

  @Test func validAccessTokenRefreshesSilentlyWhenExpired() async throws {
    let transport = StubTokenTransport(response: .success(
      status: 200,
      json: "{\"access_token\":\"access-1\",\"token_type\":\"Bearer\",\"expires_in\":7200,\"refresh_token\":\"refresh-1\"}"
    ))
    let clock = TestClock()
    let store = InMemoryTokenStore()
    let session = try OAuthSession(
      configuration: configuration(),
      store: store,
      transport: transport,
      now: { clock.now }
    )
    try await signIn(session: session, transport: transport)
    clock.now = clock.now.addingTimeInterval(8000)
    transport.response = .success(
      status: 200,
      json: "{\"access_token\":\"access-2\",\"token_type\":\"Bearer\",\"expires_in\":7200,\"refresh_token\":\"refresh-2\"}"
    )

    let token = try await session.validAccessToken()
    #expect(token == "access-2")
    #expect(await session.isSignedIn)
    #expect(await store.saved?.refreshToken == "refresh-2")
    let request = try #require(transport.lastRequest)
    let fields = Dictionary(uniqueKeysWithValues: request.fields.map { ($0.name, $0.value) })
    #expect(fields["grant_type"] == "refresh_token")
    #expect(fields["refresh_token"] == "refresh-1")
    #expect(fields["client_id"] == "mac-public-client")
    #expect(fields["code_verifier"] == nil)
  }

  @Test func networkFailureDuringRefreshKeepsSession() async throws {
    let transport = StubTokenTransport(response: .failure(UnreachableError()))
    let clock = TestClock()
    let store = InMemoryTokenStore()
    let session = try OAuthSession(
      configuration: configuration(),
      store: store,
      transport: transport,
      now: { clock.now }
    )
    try await signIn(session: session, transport: transport)
    clock.now = clock.now.addingTimeInterval(8000)
    transport.response = .failure(UnreachableError())

    await #expect(throws: UnreachableError.self) {
      try await session.validAccessToken()
    }
    // A blip is not a revocation: tokens stay, caller retries later.
    #expect(await session.isSignedIn)
    #expect(await store.saved?.refreshToken == "refresh-1")
  }

  @Test func nonGrantRejectionKeepsSession() async throws {
    let transport = StubTokenTransport(response: .success(status: 200, json: "{}"))
    let clock = TestClock()
    let store = InMemoryTokenStore()
    let session = try OAuthSession(
      configuration: configuration(),
      store: store,
      transport: transport,
      now: { clock.now }
    )
    try await signIn(session: session, transport: transport)
    clock.now = clock.now.addingTimeInterval(8000)
    for (status, code) in [(400, "invalid_client"), (401, "invalid_token")] {
      transport.response = .success(
        status: status,
        json: "{\"error\":\"\(code)\",\"error_description\":\"Not a grant problem\"}"
      )
      await #expect(throws: OAuthError.tokenExchangeFailed(
        status: status,
        message: "Not a grant problem",
        code: code
      )) {
        try await session.validAccessToken()
      }
      #expect(await session.isSignedIn)
      #expect(await store.saved?.refreshToken == "refresh-1")
    }
  }

  @Test func revokedRefreshReturnsToSignIn() async throws {
    let transport = StubTokenTransport(response: .success(
      status: 200,
      json: "{\"access_token\":\"access-1\",\"token_type\":\"Bearer\",\"expires_in\":7200,\"refresh_token\":\"refresh-1\"}"
    ))
    let clock = TestClock()
    let store = InMemoryTokenStore()
    let session = try OAuthSession(
      configuration: configuration(),
      store: store,
      transport: transport,
      now: { clock.now }
    )
    try await signIn(session: session, transport: transport)
    clock.now = clock.now.addingTimeInterval(8000)
    transport.response = .success(
      status: 400,
      json: "{\"error\":\"invalid_grant\",\"error_description\":\"Refresh revoked\"}"
    )

    await #expect(throws: OAuthError.needsSignIn) {
      try await session.validAccessToken()
    }
    #expect(await !session.isSignedIn)
    #expect(await store.saved == nil)
  }

  @Test func expiredWithoutRefreshTokenReturnsToSignIn() async throws {
    let transport = StubTokenTransport(response: .success(
      status: 200,
      json: "{\"access_token\":\"access-1\",\"token_type\":\"Bearer\",\"expires_in\":100}"
    ))
    let clock = TestClock()
    let session = try OAuthSession(
      configuration: configuration(),
      store: InMemoryTokenStore(),
      transport: transport,
      now: { clock.now }
    )
    try await signIn(session: session, transport: transport, refreshToken: nil, expiresIn: 100)
    clock.now = clock.now.addingTimeInterval(1000)

    await #expect(throws: OAuthError.needsSignIn) {
      try await session.validAccessToken()
    }
    #expect(await !session.isSignedIn)
  }
}

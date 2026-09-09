import Foundation
import SokosumiAuth
import Testing

struct SignInTests {
  private func configuration() throws -> OAuthConfiguration {
    try OAuthConfiguration(
      issuerBaseURL: #require(URL(string: "https://core.example/auth")),
      clientID: "mac-public-client"
    )
  }

  @Test func signInExchangesCodeAndPersistsTokens() async throws {
    let transport = StubTokenTransport(response: .success(
      status: 200,
      json: "{\"access_token\":\"access-1\",\"token_type\":\"Bearer\",\"expires_in\":7200,\"refresh_token\":\"refresh-1\",\"scope\":\"openid sokosumi:api offline_access\"}"
    ))
    let store = InMemoryTokenStore()
    let session = try OAuthSession(configuration: configuration(), store: store, transport: transport)

    try await session.signIn(
      callbackURL: #require(URL(string: "com.sokosumi.app:/auth?code=auth-code-1&state=state-123")),
      expectedState: "state-123",
      codeVerifier: "verifier-abc"
    )

    #expect(await session.isSignedIn)
    let saved = try #require(await store.saved)
    #expect(saved.accessToken == "access-1")
    #expect(saved.refreshToken == "refresh-1")
    let request = try #require(transport.lastRequest)
    #expect(request.url.absoluteString == "https://core.example/auth/oauth2/token")
    #expect(request.contentType == "application/x-www-form-urlencoded")
    let fields = Dictionary(uniqueKeysWithValues: request.fields.map { ($0.name, $0.value) })
    #expect(fields["grant_type"] == "authorization_code")
    #expect(fields["code"] == "auth-code-1")
    #expect(fields["redirect_uri"] == "com.sokosumi.app:/auth")
    #expect(fields["client_id"] == "mac-public-client")
    #expect(fields["code_verifier"] == "verifier-abc")
    #expect(fields["client_secret"] == nil)
  }

  @Test func signInFailsWhenTokensCannotPersist() async throws {
    let transport = StubTokenTransport(response: .success(
      status: 200,
      json: "{\"access_token\":\"access-1\",\"token_type\":\"Bearer\",\"expires_in\":7200,\"refresh_token\":\"refresh-1\"}"
    ))
    struct SaveFailed: Error {}
    let store = InMemoryTokenStore()
    store.saveError = SaveFailed()
    let session = try OAuthSession(configuration: configuration(), store: store, transport: transport)

    // The exchange succeeded but the session must not report signed in:
    // a relaunch would ask for sign-in again.
    await #expect(throws: SaveFailed.self) {
      try await session.signIn(
        callbackURL: #require(URL(string: "com.sokosumi.app:/auth?code=c&state=s")),
        expectedState: "s",
        codeVerifier: "v"
      )
    }
    #expect(await !session.isSignedIn)
  }

  @Test(arguments: ["com.sokosumi.app:/other", "com.sokosumi.app://unexpected/auth"])
  func signInRejectsCallbackWithWrongDestination(destination: String) async throws {
    let transport = StubTokenTransport(response: .success(status: 200, json: "{}"))
    let session = try OAuthSession(
      configuration: configuration(),
      store: InMemoryTokenStore(),
      transport: transport
    )

    await #expect(throws: OAuthError.invalidCallbackURL) {
      try await session.signIn(
        callbackURL: #require(URL(string: "\(destination)?code=auth-code-1&state=state-123")),
        expectedState: "state-123",
        codeVerifier: "verifier-abc"
      )
    }
    #expect(transport.lastRequest == nil)
    #expect(await !session.isSignedIn)
  }

  @Test func signInRejectsMismatchedStateWithoutCallingCore() async throws {
    let transport = StubTokenTransport(response: .success(status: 200, json: "{}"))
    let session = try OAuthSession(
      configuration: configuration(),
      store: InMemoryTokenStore(),
      transport: transport
    )

    await #expect(throws: OAuthError.stateMismatch) {
      try await session.signIn(
        callbackURL: #require(URL(string: "com.sokosumi.app:/auth?code=auth-code-1&state=other")),
        expectedState: "state-123",
        codeVerifier: "verifier-abc"
      )
    }
    #expect(transport.lastRequest == nil)
    #expect(await !session.isSignedIn)
  }

  @Test func signInSurfacesTokenErrorAndStaysSignedOut() async throws {
    let transport = StubTokenTransport(response: .success(
      status: 400,
      json: "{\"error\":\"invalid_grant\",\"error_description\":\"Code expired\"}"
    ))
    let session = try OAuthSession(
      configuration: configuration(),
      store: InMemoryTokenStore(),
      transport: transport
    )

    await #expect(throws: OAuthError.tokenExchangeFailed(status: 400, message: "Code expired", code: "invalid_grant")) {
      try await session.signIn(
        callbackURL: #require(URL(string: "com.sokosumi.app:/auth?code=stale&state=state-123")),
        expectedState: "state-123",
        codeVerifier: "verifier-abc"
      )
    }
    #expect(await !session.isSignedIn)
  }

  @Test func signOutReportsUnconfirmedDeletion() async throws {
    let transport = StubTokenTransport(response: .success(
      status: 200,
      json: "{\"access_token\":\"access-1\",\"token_type\":\"Bearer\",\"expires_in\":7200,\"refresh_token\":\"refresh-1\"}"
    ))
    let store = FailingClearStore()
    let session = try OAuthSession(configuration: configuration(), store: store, transport: transport)
    try await session.signIn(
      callbackURL: #require(URL(string: "com.sokosumi.app:/auth?code=c&state=s")),
      expectedState: "s",
      codeVerifier: "v"
    )

    #expect(await session.signOut() == false)
    #expect(await session.isSignedIn)
    #expect(await store.saved?.accessToken == "access-1")
  }

  @Test func signOutClearsStoredTokens() async throws {
    let transport = StubTokenTransport(response: .success(
      status: 200,
      json: "{\"access_token\":\"access-1\",\"token_type\":\"Bearer\",\"expires_in\":7200}"
    ))
    let store = InMemoryTokenStore()
    let session = try OAuthSession(configuration: configuration(), store: store, transport: transport)
    try await session.signIn(
      callbackURL: #require(URL(string: "com.sokosumi.app:/auth?code=c&state=s")),
      expectedState: "s",
      codeVerifier: "v"
    )
    #expect(await session.isSignedIn)

    await session.signOut()
    #expect(await !session.isSignedIn)
    #expect(await store.saved == nil)
  }
}

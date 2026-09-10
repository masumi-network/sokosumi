import Foundation

private struct TokenPayload: Decodable {
  var accessToken: String
  var refreshToken: String?
  var expiresIn: TimeInterval?
  var scope: String?

  enum CodingKeys: String, CodingKey {
    case accessToken = "access_token"
    case refreshToken = "refresh_token"
    case expiresIn = "expires_in"
    case scope
  }
}

private struct TokenErrorPayload: Decodable {
  var error: String?
  var errorDescription: String?

  enum CodingKeys: String, CodingKey {
    case error
    case errorDescription = "error_description"
  }
}

/// Owns the human session: sign-in via system-browser callback, silent
/// refresh, sign-out. UI-free so iOS can link this package later.
///
/// revoked/invalid refresh → `OAuthError.needsSignIn` (caller shows sign-in,
/// never a spinner). No cookies, no API keys: Bearer only.
public actor OAuthSession {
  private let configuration: OAuthConfiguration
  private let store: any TokenStore
  private let transport: any TokenEndpointTransport
  private let now: @Sendable () -> Date
  private var generation = 0
  private var refreshTask: Task<String, any Error>?

  public init(
    configuration: OAuthConfiguration,
    store: any TokenStore,
    transport: any TokenEndpointTransport,
    now: @escaping @Sendable () -> Date = Date.init
  ) {
    self.configuration = configuration
    self.store = store
    self.transport = transport
    self.now = now
  }

  public var isSignedIn: Bool {
    store.load() != nil
  }

  /// Completes sign-in from the `ASWebAuthenticationSession` callback URL
  /// (`com.sokosumi.app:/auth?code=…&state=…`), exchanging the code with PKCE.
  public func signIn(callbackURL: URL, expectedState: String, codeVerifier: String) async throws {
    guard
      let components = URLComponents(url: callbackURL, resolvingAgainstBaseURL: false),
      components.scheme == OAuthConfiguration.callbackScheme,
      components.path == OAuthConfiguration.redirectPath,
      components.host == nil,
      let code = components.queryItems?.first(where: { $0.name == "code" })?.value,
      !code.isEmpty
    else {
      throw OAuthError.invalidCallbackURL
    }
    let state = components.queryItems?.first(where: { $0.name == "state" })?.value
    guard state == expectedState else {
      throw OAuthError.stateMismatch
    }
    generation += 1
    let attempt = generation
    refreshTask?.cancel()
    refreshTask = nil
    let payload = try await postToken(fields: [
      (name: "grant_type", value: "authorization_code"),
      (name: "code", value: code),
      (name: "redirect_uri", value: OAuthConfiguration.redirectURI),
      (name: "client_id", value: configuration.clientID),
      (name: "code_verifier", value: codeVerifier)
    ])
    try Task.checkCancellation()
    guard generation == attempt else { throw CancellationError() }
    try store.save(payload.tokens(now: now()))
  }

  /// A usable access token: cached while fresh, silently refreshed via
  /// `offline_access` when expired. Throws `needsSignIn` when the refresh
  /// token is dead so the UI returns to sign-in.
  public func validAccessToken() async throws -> String {
    guard let tokens = store.load() else {
      throw OAuthError.needsSignIn
    }
    if !tokens.isExpired(now: now()) {
      return tokens.accessToken
    }
    let attempt = generation
    if let refreshTask {
      let token = try await refreshTask.value
      try Task.checkCancellation()
      guard generation == attempt else { throw CancellationError() }
      return token
    }
    let task = Task { try await self.refresh(tokens: tokens, generation: attempt) }
    refreshTask = task
    defer {
      if generation == attempt {
        refreshTask = nil
      }
    }
    let token = try await task.value
    try Task.checkCancellation()
    guard generation == attempt else { throw CancellationError() }
    return token
  }

  /// True only when the store confirms the tokens are gone.
  @discardableResult
  public func signOut() -> Bool {
    generation += 1
    refreshTask?.cancel()
    refreshTask = nil
    return store.clear()
  }

  private func refresh(tokens: OAuthTokens, generation attempt: Int) async throws -> String {
    try Task.checkCancellation()
    guard generation == attempt else { throw CancellationError() }
    guard let refreshToken = tokens.refreshToken, !refreshToken.isEmpty else {
      store.clear()
      throw OAuthError.needsSignIn
    }
    do {
      let payload = try await postToken(fields: [
        (name: "grant_type", value: "refresh_token"),
        (name: "refresh_token", value: refreshToken),
        (name: "client_id", value: configuration.clientID)
      ])
      try Task.checkCancellation()
      guard generation == attempt else { throw CancellationError() }
      // Some providers rotate without returning a new refresh token.
      var next = payload.tokens(now: now())
      if next.refreshToken == nil {
        next.refreshToken = tokens.refreshToken
      }
      try store.save(next)
      return next.accessToken
    } catch let failure as OAuthError where failure.isInvalidGrant {
      try Task.checkCancellation()
      guard generation == attempt else { throw CancellationError() }
      // Definitive rejection: the grant is dead, so drop the session and
      // send the user back to sign-in. Anything else (network, 5xx) keeps
      // the stored tokens so the caller can retry later.
      store.clear()
      throw OAuthError.needsSignIn
    }
  }

  private func postToken(fields: [(name: String, value: String)]) async throws -> TokenPayload {
    let (data, status) = try await transport.postForm(fields, to: configuration.tokenEndpoint)
    let decoder = JSONDecoder()
    guard status == 200, let payload = try? decoder.decode(TokenPayload.self, from: data) else {
      let errorPayload = try? decoder.decode(TokenErrorPayload.self, from: data)
      let message = errorPayload.flatMap { $0.errorDescription ?? $0.error }
        ?? HTTPURLResponse.localizedString(forStatusCode: status)
      throw OAuthError.tokenExchangeFailed(status: status, message: message, code: errorPayload?.error)
    }
    return payload
  }
}

extension TokenPayload {
  func tokens(now: Date) -> OAuthTokens {
    OAuthTokens(
      accessToken: accessToken,
      refreshToken: refreshToken,
      expiresAt: now.addingTimeInterval(expiresIn ?? 0),
      scope: scope
    )
  }
}

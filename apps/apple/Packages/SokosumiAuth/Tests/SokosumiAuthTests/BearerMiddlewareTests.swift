import Foundation
import HTTPTypes
import OpenAPIRuntime
import SokosumiAuth
import Testing

struct BearerMiddlewareTests {
  private func configuration() -> OAuthConfiguration {
    OAuthConfiguration(
      issuerBaseURL: URL(string: "https://core.example/auth")!,
      clientID: "mac-public-client"
    )
  }

  private func signedInSession(
    accessToken: String = "access-1",
    store: InMemoryTokenStore = InMemoryTokenStore()
  ) async throws -> OAuthSession {
    let transport = StubTokenTransport(response: .success(
      status: 200,
      json: "{\"access_token\":\"\(accessToken)\",\"token_type\":\"Bearer\",\"expires_in\":7200,\"refresh_token\":\"refresh-1\"}"
    ))
    let session = OAuthSession(configuration: configuration(), store: store, transport: transport)
    try await session.signIn(
      callbackURL: URL(string: "com.sokosumi.app:/auth?code=c&state=s")!,
      expectedState: "s",
      codeVerifier: "v"
    )
    return session
  }

  @Test func attachesBearerWhenSessionExists() async throws {
    let session = try await signedInSession(accessToken: "access-1")
    let inner = RecordingCoreTransport(status: 200, body: "{}")
    let middleware = BearerAuthMiddleware(session: session)

    _ = try await middleware.intercept(
      HTTPRequest(method: .get, scheme: nil, authority: nil, path: "/users/me"),
      body: nil,
      baseURL: URL(string: "https://core.example/v1")!,
      operationID: "get/users/{id}",
      next: inner.send
    )

    #expect(inner.lastRequest?.headerFields[.authorization] == "Bearer access-1")
  }

  @Test func omitsBearerAfterSignOut() async throws {
    let store = InMemoryTokenStore()
    let session = try await signedInSession(store: store)
    await session.signOut()
    let inner = RecordingCoreTransport(status: 401, body: "{}")
    let middleware = BearerAuthMiddleware(session: session)

    _ = try await middleware.intercept(
      HTTPRequest(method: .get, scheme: nil, authority: nil, path: "/users/me"),
      body: nil,
      baseURL: URL(string: "https://core.example/v1")!,
      operationID: "get/users/{id}",
      next: inner.send
    )

    #expect(inner.lastRequest?.headerFields[.authorization] == nil)
  }
}

private final class RecordingCoreTransport: @unchecked Sendable {
  var status: Int
  var body: String
  var lastRequest: HTTPRequest?

  init(status: Int, body: String) {
    self.status = status
    self.body = body
  }

  func send(
    _ request: HTTPRequest,
    _ requestBody: HTTPBody?,
    _ baseURL: URL
  ) async throws -> (HTTPResponse, HTTPBody?) {
    lastRequest = request
    return (HTTPResponse(status: HTTPResponse.Status(code: status)), HTTPBody(Data(body.utf8)))
  }
}

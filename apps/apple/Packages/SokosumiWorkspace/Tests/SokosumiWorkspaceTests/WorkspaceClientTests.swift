import CoreAPI
import Foundation
import HTTPTypes
import OpenAPIRuntime
import SokosumiAuth
import SokosumiChat
@testable import SokosumiWorkspace
import Testing

private final class RecordingTransport: ClientTransport, @unchecked Sendable {
  private(set) var requests: [HTTPRequest] = []

  func send(_ request: HTTPRequest, body _: HTTPBody?, baseURL _: URL, operationID _: String) async throws -> (HTTPResponse, HTTPBody?) {
    requests.append(request)
    return (HTTPResponse(status: .internalServerError), HTTPBody(#"{"message":"Unavailable"}"#))
  }
}

struct WorkspaceClientTests {
  private func session() throws -> OAuthSession {
    let configuration = try OAuthConfiguration(issuerBaseURL: #require(URL(string: "https://app.sokosumi.com")), clientID: "client")
    let auth = AuthState(configuration: configuration, store: InMemoryTokenStore(), browser: StubOAuthBrowser(), restoreSession: false)
    return try #require(auth.oauthSession)
  }

  /// The read cooldown waits before the bearer resolves its token, so the order is part of the contract.
  @Test func workspaceRequestsRunThroughTheStackInOrder() throws {
    let stack = try workspaceMiddlewares(session: session(), cooldown: ChatReadCooldown(), build: "7").map { String(describing: type(of: $0)) }
    #expect(stack == ["ChatReadCooldownMiddleware", "BearerAuthMiddleware", "ClientBuildMiddleware", "GuestInviteLinkExpiryMiddleware"])
  }

  @Test func theWorkspaceClientSendsThroughThatStack() async throws {
    let transport = RecordingTransport()
    let client = try Client.workspace(session: session(), cooldown: ChatReadCooldown(),
                                      baseURL: #require(URL(string: "https://core.example/v1")), build: "7", transport: transport)
    _ = try? await ChatService().searchSkills(client: client, query: "")
    let request = try #require(transport.requests.first)
    #expect(try request.headerFields[#require(HTTPField.Name("X-Sokosumi-Client"))] == "macos/7")
  }
}

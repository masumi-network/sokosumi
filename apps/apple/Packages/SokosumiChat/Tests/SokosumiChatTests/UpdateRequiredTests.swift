import CoreAPI
import Foundation
import HTTPTypes
import OpenAPIRuntime
@testable import SokosumiChat
import Testing

@MainActor
struct UpdateRequiredTests {
  @Test func outdatedBuildOpensTheUpdateScreen() async throws {
    let state = WorkspaceSession()
    await #expect(throws: ClientError.self) { try await state.load(client: client()) }
    #expect(state.phase == .updateRequired)
  }

  @Test func inlineErrorsTellThePersonToUpdate() async throws {
    let error = await #expect(throws: ClientError.self) {
      try await client().getUsersIdWorkspaces(path: .init(id: "me"))
    }
    let message = try friendlyMessage(for: #require(error))
    #expect(message.contains("out of date"))
    #expect(message.contains("https://github.com/masumi-network/sokosumi/releases/download/macos-latest/Sokosumi.dmg"))
  }

  @Test func theRoleProbeDoesNotHideAnUpdate() async throws {
    let error = await #expect(throws: ClientError.self) {
      try await ChatService().organizationOwnerOrAdminIfReadable(client: client(), organizationId: "org_1")
    }
    #expect(try updateRequired(in: #require(error)) == CoreUpdateRequired())
  }

  private func client() throws -> Client {
    try Client.connecting(
      to: #require(URL(string: "https://core.example/v1")),
      transport: OutdatedTransport(),
      middlewares: [ClientBuildMiddleware(build: "2")]
    )
  }
}

/// Core's answer to a build below the minimum.
private struct OutdatedTransport: ClientTransport {
  func send(
    _: HTTPRequest,
    body _: HTTPBody?,
    baseURL _: URL,
    operationID _: String
  ) async throws -> (HTTPResponse, HTTPBody?) {
    let body = """
    {"error":"UpgradeRequired","message":"This version of Sokosumi is out of date.","kind":"client_update_required","meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"req-1","path":"/v1/users/me/workspaces","method":"GET"}}
    """
    return (HTTPResponse(status: .init(code: 426), headerFields: [.contentType: "application/json"]), HTTPBody(body))
  }
}

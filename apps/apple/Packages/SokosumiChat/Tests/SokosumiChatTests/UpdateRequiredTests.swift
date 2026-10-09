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
    await #expect(throws: ClientError.self) { try await state.load(client: client(channel: .developerID)) }
    #expect(state.phase == .updateRequired(.developerID))
  }

  @Test func inlineErrorsTellThePersonToUpdate() async throws {
    let error = await #expect(throws: ClientError.self) {
      try await client(channel: .developerID).getUsersIdWorkspaces(path: .init(id: "me"))
    }
    let message = try friendlyMessage(for: #require(error))
    #expect(message.contains("out of date"))
    #expect(message.contains(latestDownloadURL.absoluteString))
    #expect(friendlyMessage(for: CoreUpdateRequired(channel: .appStore)).contains("App Store"))
  }

  private func client(channel: DistributionChannel) throws -> Client {
    try Client.connecting(
      to: #require(URL(string: "https://core.example/v1")),
      transport: OutdatedTransport(),
      middlewares: [ClientBuildMiddleware(channel: channel, build: "2")]
    )
  }
}

/// Core's answer to a build below its channel's minimum.
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

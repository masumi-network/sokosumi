import CoreAPI
import Foundation
import HTTPTypes
import OpenAPIRuntime
import Testing

struct ClientBuildMiddlewareTests {
  @Test func namesTheBuildOnEveryRequest() async throws {
    let transport = StubTransport(status: 204, body: "")
    _ = try? await client(transport, channel: .developerID).getUsersId(path: .init(id: "me"))
    let header = try #require(HTTPField.Name("X-Sokosumi-Client"))
    #expect(transport.lastRequest?.headerFields[header] == "macos-developer-id/7993")
  }

  @Test func clientUpdateRequiredThrowsUpdateRequired() async throws {
    let transport = StubTransport(status: 426, body: errorBody(kind: "client_update_required"))
    let error = await #expect(throws: ClientError.self) {
      try await client(transport, channel: .appStore).getUsersId(path: .init(id: "me"))
    }
    #expect(error?.underlyingError as? CoreUpdateRequired == CoreUpdateRequired(channel: .appStore))
  }

  @Test func removedOperationThrowsUpdateRequired() async throws {
    let transport = StubTransport(status: 404, body: errorBody(kind: "route_not_found"))
    let error = await #expect(throws: ClientError.self) {
      try await client(transport, channel: .developerID).getUsersId(path: .init(id: "me"))
    }
    #expect(error?.underlyingError as? CoreUpdateRequired == CoreUpdateRequired(channel: .developerID))
  }

  @Test func missingResourceStaysANotFound() async throws {
    let transport = StubTransport(status: 404, body: errorBody(kind: nil))
    let response = try await client(transport, channel: .developerID).getUsersId(path: .init(id: "me"))
    guard case let .notFound(notFound) = response else {
      Issue.record("expected 404, got \(response)")
      return
    }
    #expect(try notFound.body.json.message == "User not found")
  }

  @Test func anOversizedNotFoundPassesThrough() async throws {
    let message = String(repeating: "x", count: 70 * 1024)
    let body = #"{"error":"NotFound","message":"\#(message)","meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"req-1","path":"/v1/users/me","method":"GET"}}"#
    let response = try await client(StubTransport(status: 404, body: body), channel: .developerID).getUsersId(path: .init(id: "me"))
    guard case let .notFound(notFound) = response else {
      Issue.record("expected 404, got \(response)")
      return
    }
    #expect(try notFound.body.json.message == message)
  }

  private func client(_ transport: StubTransport, channel: DistributionChannel) throws -> Client {
    try Client.connecting(
      to: #require(URL(string: "https://core.example/v1")),
      transport: transport,
      middlewares: [ClientBuildMiddleware(channel: channel, build: "7993")]
    )
  }
}

private func errorBody(kind: String?) -> String {
  let kindField = kind.map { #","kind":"\#($0)""# } ?? ""
  return """
  {"error":"Error","message":"User not found"\(kindField),"meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"req-1","path":"/v1/users/me","method":"GET"}}
  """
}

private final class StubTransport: ClientTransport, @unchecked Sendable {
  let status: Int
  let body: String
  var lastRequest: HTTPRequest?

  init(status: Int, body: String) {
    self.status = status
    self.body = body
  }

  func send(
    _ request: HTTPRequest,
    body _: HTTPBody?,
    baseURL _: URL,
    operationID _: String
  ) async throws -> (HTTPResponse, HTTPBody?) {
    lastRequest = request
    return (HTTPResponse(status: .init(code: status), headerFields: [.contentType: "application/json"]), HTTPBody(body))
  }
}

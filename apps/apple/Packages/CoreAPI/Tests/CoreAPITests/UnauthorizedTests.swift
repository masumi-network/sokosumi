import CoreAPI
import Foundation
import HTTPTypes
import OpenAPIRuntime
import Testing

struct UnauthorizedTests {
  @Test func getUsersMeWithoutTokenIsUnauthorized() async throws {
    let transport = RecordingTransport(
      status: 401,
      body: """
        {"error":"Unauthorized","message":"Invalid, expired or missing session","meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"req-1","path":"/v1/users/me","method":"GET"}}
        """
    )
    let client = Client.connecting(
      to: URL(string: "https://core.example/v1")!,
      transport: transport
    )
    let response = try await client.getUsersId(path: .init(id: "me"))
    guard case .unauthorized(let unauthorized) = response else {
      Issue.record("expected 401, got \(response)")
      return
    }
    let payload = try unauthorized.body.json
    #expect(payload.error == "Unauthorized")
    #expect(payload.message == "Invalid, expired or missing session")
    #expect(transport.lastRequest?.headerFields[.authorization] == nil)
    #expect(transport.lastRequest?.path?.hasSuffix("/users/me") == true)
    #expect(transport.lastOperationID == "get/users/{id}")
  }
}

private final class RecordingTransport: ClientTransport, @unchecked Sendable {
  var status: Int
  var body: String
  var lastRequest: HTTPRequest?
  var lastOperationID: String?

  init(status: Int, body: String) {
    self.status = status
    self.body = body
  }

  func send(
    _ request: HTTPRequest,
    body: HTTPBody?,
    baseURL: URL,
    operationID: String
  ) async throws -> (HTTPResponse, HTTPBody?) {
    lastRequest = request
    lastOperationID = operationID
    return (
      HTTPResponse(status: HTTPResponse.Status(code: status)),
      HTTPBody(self.body)
    )
  }
}

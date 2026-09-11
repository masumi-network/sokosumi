import CoreAPI
import Foundation
import HTTPTypes
import OpenAPIRuntime
import SokosumiChat
import Testing

private actor AttachmentGrantTransport: ClientTransport {
  var request: HTTPRequest?
  var body: String?

  func send(_ request: HTTPRequest, body: HTTPBody?, baseURL _: URL, operationID _: String) async throws -> (HTTPResponse, HTTPBody?) {
    self.request = request
    if let body {
      self.body = try await String(collecting: body, upTo: 8192)
    }
    return (.init(status: .created, headerFields: [.contentType: "application/json"]), HTTPBody("""
    {"data":{"uploadUrl":"https://blob.example/upload","pathname":"users/me/chats/room/a.txt","access":"public","method":"PUT","headers":{"Content-Type":"text/plain"},"expiresAt":"2099-01-01T00:00:00Z","maxSizeBytes":104857600,"addRandomSuffix":true},"meta":{"timestamp":"2026-09-11T00:00:00Z","requestId":"test"}}
    """))
  }
}

@Test func attachmentGrantUsesRoomRouteAndWorkspaceHeader() async throws {
  let transport = AttachmentGrantTransport()
  let client = try Client(serverURL: #require(URL(string: "https://core.example/v1")), transport: transport)
  let grant = try await ChatService().attachmentGrant(client: client, roomId: "room-id", file: .init(filename: "a.txt", contentType: "text/plain", size: 5), organizationSlug: "org")
  let request = await transport.request
  #expect(request?.method == .post)
  #expect(request?.path == "/chats/rooms/room-id/files")
  #expect(try request?.headerFields[#require(HTTPField.Name("X-Organization-Slug"))] == "org")
  let body = try #require(await transport.body)
  let object = try #require(JSONSerialization.jsonObject(with: Data(body.utf8)) as? [String: Any])
  #expect(object["filename"] as? String == "a.txt")
  #expect(object["size"] as? Int == 5)
  #expect(grant.headers.contentType == "text/plain")
}

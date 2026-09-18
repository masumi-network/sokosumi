import CoreAPI
import Foundation
import HTTPTypes
import OpenAPIRuntime
import SokosumiChat
import Testing

private func preferencesBody(showRoomUnreadCount: Bool) -> String {
  """
  {"data":{"marketingOptIn":false,"notificationsOptIn":false,"pushOptIn":false,"showRoomUnreadCount":\(showRoomUnreadCount),"notificationPreferences":[]},"meta":{"timestamp":"\(testTimestamp)","requestId":"test"}}
  """
}

private let errorBody = #"{"error":"Error","message":"Nope","meta":{"timestamp":"\#(testTimestamp)","requestId":"test","path":"/users/me/preferences","method":"PATCH"}}"#

@MainActor
struct ChatDisplayPreferencesTests {
  @Test(arguments: [false, true])
  func refreshReadsTheCurrentUserAndResets(enabled: Bool) async throws {
    let transport = TestTransport([(200, preferencesBody(showRoomUnreadCount: enabled))])
    let preferences = ChatDisplayPreferences()
    #expect(!preferences.showsRoomUnreadCount)
    try await preferences.refresh(client: makeTestClient(transport))
    #expect(preferences.showsRoomUnreadCount == enabled)
    let request = try #require(transport.requests.first?.request)
    #expect(request.method == .get && request.path == "/users/me/preferences")
    #expect(testOrgSlugHeader(request) == nil)
    preferences.reset()
    #expect(!preferences.showsRoomUnreadCount && !preferences.isSaving)
  }

  @Test func writePatchesOnlyTheUnreadCountFlag() async throws {
    let transport = TestTransport([(200, preferencesBody(showRoomUnreadCount: true))])
    let preferences = ChatDisplayPreferences()
    try await preferences.setShowsRoomUnreadCount(true, client: makeTestClient(transport))
    #expect(preferences.showsRoomUnreadCount && !preferences.isSaving)
    let request = try #require(transport.requests.first?.request)
    #expect(request.method == .patch && request.path == "/users/me/preferences")
    #expect(testOrgSlugHeader(request) == nil)
    let body = try #require(JSONSerialization.jsonObject(with: transport.bodies[0]) as? [String: Bool])
    #expect(body == ["showRoomUnreadCount": true])
  }

  @Test func unchangedValueSendsNothing() async throws {
    let transport = TestTransport([])
    let preferences = ChatDisplayPreferences()
    try await preferences.setShowsRoomUnreadCount(false, client: makeTestClient(transport))
    #expect(transport.requests.isEmpty)
  }

  @Test func writeIsOptimisticSingleFlightAndShieldedFromAStaleRead() async throws {
    let gate = GatedPreferencesTransport(status: 200, body: preferencesBody(showRoomUnreadCount: true))
    let client = try Client.connecting(to: #require(URL(string: "https://core.example/v1")), transport: gate)
    let preferences = ChatDisplayPreferences()
    let write = Task { try await preferences.setShowsRoomUnreadCount(true, client: client) }
    await gate.waitForRequest()
    #expect(preferences.showsRoomUnreadCount && preferences.isSaving)

    // A second toggle while saving is ignored, like web's disabled switch.
    let extra = TestTransport([(200, preferencesBody(showRoomUnreadCount: false))])
    try await preferences.setShowsRoomUnreadCount(false, client: makeTestClient(extra))
    #expect(extra.requests.isEmpty)
    // A read that answers during the write cannot undo the optimistic value.
    try await preferences.refresh(client: makeTestClient(extra))
    #expect(extra.requests.count == 1 && preferences.showsRoomUnreadCount)

    await gate.release()
    try await write.value
    #expect(preferences.showsRoomUnreadCount && !preferences.isSaving)
    #expect(await gate.requestCount == 1)
  }

  @Test(arguments: [400, 401, 403, 404, 500])
  func failedWriteRollsBackAndRethrows(status: Int) async throws {
    let gate = GatedPreferencesTransport(status: status, body: errorBody)
    let client = try Client.connecting(to: #require(URL(string: "https://core.example/v1")), transport: gate)
    let preferences = ChatDisplayPreferences()
    let write = Task { try await preferences.setShowsRoomUnreadCount(true, client: client) }
    await gate.waitForRequest()
    #expect(preferences.showsRoomUnreadCount && preferences.isSaving)
    await gate.release()
    let error = await #expect(throws: ChatServiceError.self) { try await write.value }
    #expect(error == (status == 401 ? .unauthorized("Nope") : .unprocessable(statusCode: status, message: "Nope")))
    #expect(!preferences.showsRoomUnreadCount && !preferences.isSaving)
  }

  @Test func writeCompletionDropsARefreshThatStartedDuringTheWrite() async throws {
    let writeGate = GatedPreferencesTransport(status: 200, body: preferencesBody(showRoomUnreadCount: true))
    let readGate = GatedPreferencesTransport(status: 200, body: preferencesBody(showRoomUnreadCount: false))
    let writeClient = try Client.connecting(to: #require(URL(string: "https://core.example/v1")), transport: writeGate)
    let readClient = try Client.connecting(to: #require(URL(string: "https://core.example/v1")), transport: readGate)
    let preferences = ChatDisplayPreferences()
    let write = Task { try await preferences.setShowsRoomUnreadCount(true, client: writeClient) }
    await writeGate.waitForRequest()
    let read = Task { try await preferences.refresh(client: readClient) }
    await readGate.waitForRequest()
    await writeGate.release()
    try await write.value
    #expect(preferences.showsRoomUnreadCount && !preferences.isSaving)
    await readGate.release()
    try await read.value
    #expect(preferences.showsRoomUnreadCount)
  }

  @Test func resetDropsALateWriteResult() async throws {
    let gate = GatedPreferencesTransport(status: 200, body: preferencesBody(showRoomUnreadCount: true))
    let client = try Client.connecting(to: #require(URL(string: "https://core.example/v1")), transport: gate)
    let preferences = ChatDisplayPreferences()
    let write = Task { try await preferences.setShowsRoomUnreadCount(true, client: client) }
    await gate.waitForRequest()
    preferences.reset()
    await gate.release()
    try await write.value
    #expect(!preferences.showsRoomUnreadCount && !preferences.isSaving)
  }
}

actor GatedPreferencesTransport: ClientTransport {
  let status: Int
  let body: String
  private var waiter: CheckedContinuation<Void, Never>?
  private var observer: CheckedContinuation<Void, Never>?
  private(set) var requestCount = 0

  init(status: Int, body: String) {
    self.status = status
    self.body = body
  }

  func waitForRequest() async {
    if waiter != nil {
      return
    }
    await withCheckedContinuation { observer = $0 }
  }

  func release() {
    waiter?.resume()
    waiter = nil
  }

  func send(_: HTTPRequest, body _: HTTPBody?, baseURL _: URL, operationID _: String) async throws -> (HTTPResponse, HTTPBody?) {
    requestCount += 1
    await withCheckedContinuation {
      waiter = $0
      observer?.resume()
      observer = nil
    }
    return (HTTPResponse(status: .init(code: status), headerFields: [.contentType: "application/json"]), HTTPBody(body))
  }
}

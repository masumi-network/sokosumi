import CoreAPI
import Foundation
import SokosumiChat
import Testing

private func cell(_ category: String, _ channel: String, _ enabled: Bool) -> String {
  #"{"category":"\#(category)","channel":"\#(channel)","enabled":\#(enabled)}"#
}

/// Core's defaults: mentions and direct messages everywhere, room messages off, plus one non-chat row.
private func matrixBody(
  room: (Bool, Bool) = (false, false), mention: (Bool, Bool) = (true, true), direct: (Bool, Bool) = (true, true),
  otherBanner: Bool = true, pushOptIn: Bool = false
) -> String {
  let cells = [
    cell("TASK_ATTENTION", "IN_APP", true), cell("TASK_ATTENTION", "OS_BANNER", otherBanner),
    cell("CHAT_ROOM_MESSAGE", "IN_APP", room.0), cell("CHAT_ROOM_MESSAGE", "OS_BANNER", room.1),
    cell("CHAT_MENTION", "IN_APP", mention.0), cell("CHAT_MENTION", "OS_BANNER", mention.1),
    cell("CHAT_DIRECT_MESSAGE", "IN_APP", direct.0), cell("CHAT_DIRECT_MESSAGE", "OS_BANNER", direct.1),
    cell("FOLLOW_UP", "EMAIL", true)
  ].joined(separator: ",")
  return """
  {"data":{"marketingOptIn":false,"notificationsOptIn":false,"pushOptIn":\(pushOptIn),"showRoomUnreadCount":false,"notificationPreferences":[\(cells)]},"meta":{"timestamp":"\(testTimestamp)","requestId":"test"}}
  """
}

private let errorBody = #"{"error":"Error","message":"Nope","meta":{"timestamp":"\#(testTimestamp)","requestId":"test","path":"/users/me/preferences","method":"PATCH"}}"#

private func patchBody(_ transport: TestTransport, at index: Int) throws -> [String: Any] {
  try #require(JSONSerialization.jsonObject(with: transport.bodies[index]) as? [String: Any])
}

private func writtenCells(_ body: [String: Any]) throws -> Set<String> {
  let cells = try #require(body["notificationPreferences"] as? [[String: Any]])
  return Set(cells.map { "\($0["category"] ?? "")/\($0["channel"] ?? "")=\($0["enabled"] as? Bool == true)" })
}

@MainActor
struct ChatNotificationPreferencesTests {
  @Test func refreshReadsTheMatrixAndNamesThePreset() async throws {
    let transport = TestTransport([(200, matrixBody(pushOptIn: true)), (200, matrixBody(room: (true, true)))])
    let preferences = ChatNotificationPreferences()
    #expect(!preferences.isLoaded && preferences.kinds.isEmpty && preferences.preset == nil)
    try await preferences.refresh(client: makeTestClient(transport))
    let request = try #require(transport.requests.first?.request)
    #expect(request.method == .get && request.path == "/users/me/preferences" && testOrgSlugHeader(request) == nil)
    #expect(preferences.isLoaded && preferences.pushOptIn && preferences.kinds == ChatNotificationKind.allCases)
    #expect(preferences.preset == .essential && preferences.wantsBanner)
    #expect(preferences.reach(for: .roomMessage) == .off && preferences.reach(for: .mention) == .banner)
    // A room on the banner is no preset's situation.
    try await preferences.refresh(client: makeTestClient(transport))
    #expect(preferences.preset == nil && preferences.reach(for: .roomMessage) == .banner)
    preferences.reset()
    #expect(!preferences.isLoaded && preferences.cells.isEmpty && !preferences.pushOptIn)
  }

  @Test func presetWritesTheWholeGroupInOneRequestAndAsksTheOS() async throws {
    let transport = TestTransport([
      (200, matrixBody(mention: (true, false), direct: (true, false))),
      (200, matrixBody(room: (true, false), pushOptIn: true))
    ])
    let client = try makeTestClient(transport)
    let preferences = ChatNotificationPreferences()
    try await preferences.refresh(client: client)
    #expect(preferences.preset == .appOnly)
    var asked = 0
    try await preferences.setReach(preferences.changes(for: .most), client: client) { asked += 1 }
    #expect(asked == 1 && transport.requests.count == 2)
    let request = transport.requests[1].request
    #expect(request.method == .patch && request.path == "/users/me/preferences" && testOrgSlugHeader(request) == nil)
    let body = try patchBody(transport, at: 1)
    // Consent rides with the cells; only chat cells are written, never another group's or an email cell.
    #expect(body["pushOptIn"] as? Bool == true && Set(body.keys) == ["pushOptIn", "notificationPreferences"])
    #expect(try writtenCells(body) == [
      "CHAT_ROOM_MESSAGE/IN_APP=true", "CHAT_ROOM_MESSAGE/OS_BANNER=false",
      "CHAT_MENTION/IN_APP=true", "CHAT_MENTION/OS_BANNER=true",
      "CHAT_DIRECT_MESSAGE/IN_APP=true", "CHAT_DIRECT_MESSAGE/OS_BANNER=true"
    ])
    #expect(preferences.preset == .most && preferences.pushOptIn && !preferences.isSaving)
  }

  @Test func quietWriteNeitherAsksNorTouchesConsentWhileAnotherGroupKeepsABanner() async throws {
    let transport = TestTransport([(200, matrixBody(pushOptIn: true)), (200, matrixBody(mention: (true, false), pushOptIn: true))])
    let client = try makeTestClient(transport)
    let preferences = ChatNotificationPreferences()
    try await preferences.refresh(client: client)
    var asked = 0
    try await preferences.setReach([.mention: .inApp], client: client) { asked += 1 }
    // The write itself leaves no banner on, so the OS is not asked; other banners still stand, so consent stays.
    #expect(asked == 0)
    let body = try patchBody(transport, at: 1)
    #expect(body["pushOptIn"] == nil)
    #expect(try writtenCells(body) == ["CHAT_MENTION/IN_APP=true", "CHAT_MENTION/OS_BANNER=false"])
  }

  @Test func lastBannerOffReleasesTheConsent() async throws {
    let transport = TestTransport([
      (200, matrixBody(mention: (true, false), direct: (true, true), otherBanner: false, pushOptIn: true)),
      (200, matrixBody(mention: (true, false), direct: (false, false), otherBanner: false, pushOptIn: false))
    ])
    let client = try makeTestClient(transport)
    let preferences = ChatNotificationPreferences()
    try await preferences.refresh(client: client)
    try await preferences.setReach([.directMessage: .off], client: client) {}
    let body = try patchBody(transport, at: 1)
    #expect(body["pushOptIn"] as? Bool == false)
    #expect(try writtenCells(body) == ["CHAT_DIRECT_MESSAGE/IN_APP=false", "CHAT_DIRECT_MESSAGE/OS_BANNER=false"])
    #expect(!preferences.pushOptIn && preferences.reach(for: .directMessage) == .off)
  }

  @Test func unchangedOrUnloadedWritesSendNothing() async throws {
    let transport = TestTransport([(200, matrixBody())])
    let client = try makeTestClient(transport)
    let preferences = ChatNotificationPreferences()
    try await preferences.setReach([.mention: .off], client: client) {}
    #expect(transport.requests.isEmpty)
    try await preferences.refresh(client: client)
    try await preferences.setReach([.mention: .banner], client: client) {}
    #expect(transport.requests.count == 1)
  }

  @Test(arguments: [400, 401, 403, 404, 500])
  func failedWriteRollsBackCellsAndConsent(status: Int) async throws {
    let read = TestTransport([(200, matrixBody())])
    let gate = GatedPreferencesTransport(status: status, body: errorBody)
    let client = try Client.connecting(to: #require(URL(string: "https://core.example/v1")), transport: gate)
    let preferences = ChatNotificationPreferences()
    try await preferences.refresh(client: makeTestClient(read))
    let write = Task { try await preferences.setReach([.roomMessage: .banner], client: client) {} }
    await gate.waitForRequest()
    #expect(preferences.reach(for: .roomMessage) == .banner && preferences.pushOptIn && preferences.isSaving)
    // Single flight, and a read during the write cannot undo the optimistic value.
    try await preferences.setReach([.mention: .off], client: makeTestClient(read)) {}
    try await preferences.refresh(client: makeTestClient(TestTransport([(200, matrixBody())])))
    #expect(read.requests.count == 1 && preferences.reach(for: .roomMessage) == .banner)
    await gate.release()
    let error = await #expect(throws: ChatServiceError.self) { try await write.value }
    #expect(error == (status == 401 ? .unauthorized("Nope") : .unprocessable(statusCode: status, message: "Nope")))
    #expect(preferences.reach(for: .roomMessage) == .off && !preferences.pushOptIn && !preferences.isSaving)
  }

  @Test func resetDropsALateWriteResult() async throws {
    let gate = GatedPreferencesTransport(status: 200, body: matrixBody(room: (true, false)))
    let client = try Client.connecting(to: #require(URL(string: "https://core.example/v1")), transport: gate)
    let preferences = ChatNotificationPreferences()
    try await preferences.refresh(client: makeTestClient(TestTransport([(200, matrixBody())])))
    let write = Task { try await preferences.setReach([.roomMessage: .inApp], client: client) {} }
    await gate.waitForRequest()
    preferences.reset()
    await gate.release()
    try await write.value
    #expect(!preferences.isLoaded && preferences.cells.isEmpty && !preferences.isSaving)
  }

  @Test func notificationReadAndWorkspaceLookupHitTheirRoutes() async throws {
    let item = #"{"data":{"id":"n1","userId":"u","kind":"CHAT","referenceId":"r","eventId":"m","messageKey":"k","messageParams":{},"metadata":null,"isRead":true,"readAt":"\#(testTimestamp)","createdAt":"\#(testTimestamp)"},"meta":{"timestamp":"\#(testTimestamp)","requestId":"test"}}"#
    let transport = TestTransport([
      (200, item),
      (200, #"{"data":{"organizationId":"org_1"},"meta":{"timestamp":"\#(testTimestamp)","requestId":"test"}}"#),
      (200, #"{"data":{"organizationId":null},"meta":{"timestamp":"\#(testTimestamp)","requestId":"test"}}"#),
      (404, errorBody)
    ])
    let client = try makeTestClient(transport)
    try await ChatService().markNotificationRead(client: client, id: "n1")
    #expect(transport.requests[0].request.method == .patch && transport.requests[0].request.path == "/notifications/n1/read")
    #expect(try await ChatService().workspaceOrganizationId(client: client, workspaceId: "ws_1") == "org_1")
    #expect(transport.requests[1].request.path == "/workspaces/ws_1")
    #expect(try await ChatService().workspaceOrganizationId(client: client, workspaceId: "ws_2") == nil)
    await #expect(throws: ChatServiceError.self) { try await ChatService().markNotificationRead(client: client, id: "gone") }
  }
}

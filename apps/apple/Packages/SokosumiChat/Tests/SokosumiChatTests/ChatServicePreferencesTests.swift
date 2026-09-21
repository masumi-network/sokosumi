import CoreAPI
import Foundation
import SokosumiChat
import Testing

private func preferencesBody(
  showRoomUnreadCount: Bool = true,
  pushOptIn: Bool = true,
  mentionInAppEnabled: Bool = true
) -> String {
  """
  {"data":{"marketingOptIn":false,"notificationsOptIn":false,"pushOptIn":\(pushOptIn),"showRoomUnreadCount":\(showRoomUnreadCount),"notificationPreferences":[{"category":"CHAT_MENTION","channel":"IN_APP","enabled":\(mentionInAppEnabled)}]},"meta":{"timestamp":"\(testTimestamp)","requestId":"test"}}
  """
}

private let errorBody = #"{"error":"Error","message":"Nope","meta":{"timestamp":"\#(testTimestamp)","requestId":"test","path":"/users/me/preferences","method":"PATCH"}}"#

struct ChatServicePreferencesTests {
  @Test func getProjectsTheSharedSnapshotWithoutAnOrgHeader() async throws {
    let transport = TestTransport([(200, preferencesBody())])
    let snapshot = try await ChatService().userPreferences(client: makeTestClient(transport))
    #expect(snapshot.showRoomUnreadCount && snapshot.pushOptIn)
    #expect(snapshot.cells == [.init(category: .chatMention, channel: .inApp, enabled: true)])
    let request = try #require(transport.requests.first?.request)
    #expect(request.method == .get && request.path == "/users/me/preferences")
    #expect(testOrgSlugHeader(request) == nil)
  }

  @Test func patchSendsOnlyTheFieldsTheCallerChanged() async throws {
    let transport = TestTransport([
      (200, preferencesBody()),
      (200, preferencesBody(showRoomUnreadCount: false, pushOptIn: false, mentionInAppEnabled: false))
    ])
    let client = try makeTestClient(transport)
    let display = try await ChatService().updateUserPreferences(client: client, showRoomUnreadCount: true)
    #expect(display.showRoomUnreadCount)
    #expect(try JSONSerialization.jsonObject(with: transport.bodies[0]) as? [String: Bool] == ["showRoomUnreadCount": true])

    let cell = NotificationPreferenceCell(category: .chatMention, channel: .inApp, enabled: false)
    let delivery = try await ChatService().updateUserPreferences(
      client: client,
      pushOptIn: false,
      notificationPreferences: [cell]
    )
    #expect(!delivery.pushOptIn && delivery.cells == [cell])
    let body = try #require(JSONSerialization.jsonObject(with: transport.bodies[1]) as? [String: Any])
    #expect(body["pushOptIn"] as? Bool == false)
    #expect(body["showRoomUnreadCount"] == nil)
    let cells = try #require(body["notificationPreferences"] as? [[String: Any]])
    #expect(cells.count == 1 && cells[0]["enabled"] as? Bool == false)
    #expect(transport.requests.allSatisfy { $0.request.method == .patch && testOrgSlugHeader($0.request) == nil })
  }

  @Test(arguments: [401, 403, 404, 500])
  func getMapsDocumentedFailures(status: Int) async throws {
    let transport = TestTransport([(status, errorBody)])
    let error = await #expect(throws: ChatServiceError.self) {
      try await ChatService().userPreferences(client: makeTestClient(transport))
    }
    #expect(error == (status == 401 ? .unauthorized("Nope") : .unprocessable(statusCode: status, message: "Nope")))
  }

  @Test(arguments: [400, 401, 403, 404, 500])
  func patchMapsDocumentedFailures(status: Int) async throws {
    let transport = TestTransport([(status, errorBody)])
    let error = await #expect(throws: ChatServiceError.self) {
      try await ChatService().updateUserPreferences(client: makeTestClient(transport), showRoomUnreadCount: true)
    }
    #expect(error == (status == 401 ? .unauthorized("Nope") : .unprocessable(statusCode: status, message: "Nope")))
  }
}

import CoreAPI
import Foundation
import SokosumiChat
import Testing

@MainActor
struct ThreadTimelineTests {
  private func reply(_ id: String, parent: String?) -> String {
    let row = testMessageJSON(id: id, content: id, sender: testUserSender(name: "Ada", email: "ada@example.com"))
    guard let parent else { return row }
    return row.replacingOccurrences(of: "\"parentMessageId\":null", with: "\"parentMessageId\":\"\(parent)\"")
  }

  @Test func threadPagesExcludeParentAndOtherThreadsAndPreserveCursor() async throws {
    let transport = TestTransport([
      (200, testMessagesPageBody(messages: [reply("root", parent: nil), reply("new", parent: "root"), reply("foreign", parent: "other")], nextCursor: "older")),
      (200, testMessagesPageBody(messages: [reply("new", parent: "root"), reply("newest", parent: "root")], nextCursor: "unused")),
      (200, testMessagesPageBody(messages: [reply("old", parent: "root")], nextCursor: nil))
    ])
    let client = try makeTestClient(transport)
    let timeline = RoomTimeline()
    timeline.reset(roomId: testRoomId, parentMessageId: "root")
    let generation = timeline.generation
    #expect(timeline.isLoading)
    _ = try await timeline.loadPage(.initial, client: client, organizationSlug: nil, generation: generation)
    #expect(timeline.messages.map(\.id) == ["new"])
    _ = try await timeline.loadPage(.latest, client: client, organizationSlug: nil, generation: generation)
    #expect(timeline.cursor == "older")
    _ = try await timeline.loadPage(.older, client: client, organizationSlug: nil, generation: generation)
    #expect(Set(timeline.messages.map(\.id)) == ["old", "new", "newest"])
    #expect(!timeline.hasMore)
    #expect(transport.requests.allSatisfy { $0.operationID == "get/chats/rooms/{id}/threads/{parentMessageId}/messages" })
  }

  @Test func replyEventsAndShellsStayInTheirParentScope() {
    let shell = OutboundShell(clientTurnId: "turn", roomId: testRoomId, parentMessageId: "root", content: "reply",
                              sender: .init(id: "me", name: "Me", email: "me@example.com", presence: .online))
    var confirmed = chatRoomMessage(from: shell)
    confirmed.id = "confirmed"
    #expect(confirmed.parentMessageId == "root")
    let room = applyRealtimeFullEvent(messages: [], shells: [], eventType: .create, message: confirmed)
    #expect(room.messages.isEmpty)
    let thread = applyRealtimeFullEvent(messages: [], shells: [shell], eventType: .create, message: confirmed, parentMessageId: "root")
    #expect(thread.messages.map(\.id) == ["confirmed"])
    #expect(thread.shells.isEmpty)
    let other = applyRealtimeFullEvent(messages: [], shells: [], eventType: .create, message: confirmed, parentMessageId: "other")
    #expect(other.messages.isEmpty)
    let patch = RealtimeMessagePatch(roomId: testRoomId, messageId: "confirmed", parentMessageId: "root", value: .unfurls([]))
    #expect(applyRealtimePatch(patch, messages: [confirmed], parentMessageId: "root").first?.unfurls != nil)
    #expect(applyRealtimePatch(patch, messages: [confirmed]).first?.unfurls == nil)
    let envelope = ChatRoomMessageIdEnvelope(eventType: .create, messageId: "reply", roomId: testRoomId, parentMessageId: "root")
    #expect(resolveRealtimeEnvelope(envelope, focusedRoomId: testRoomId, parentMessageId: "root") == .needsRefetch)
    #expect(resolveRealtimeEnvelope(envelope, focusedRoomId: testRoomId) == .ignore)
  }

  @Test func draftsStaySeparateForRoomAndEachThread() throws {
    let name = "thread-drafts-\(UUID())"
    let defaults = try #require(UserDefaults(suiteName: name))
    defer { defaults.removePersistentDomain(forName: name) }
    let scopes: [String?] = [nil, "root", "other"]
    for (index, parent) in scopes.enumerated() {
      SavedComposeDraft(userId: "me", organizationId: nil, roomId: testRoomId, parentMessageId: parent, defaults: defaults).save("Draft \(index)")
    }
    for (index, parent) in scopes.enumerated() {
      #expect(SavedComposeDraft(userId: "me", organizationId: nil, roomId: testRoomId, parentMessageId: parent, defaults: defaults).load() == "Draft \(index)")
    }
  }
}

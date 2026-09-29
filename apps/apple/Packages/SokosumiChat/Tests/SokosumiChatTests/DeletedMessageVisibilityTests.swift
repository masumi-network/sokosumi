import CoreAPI
import Foundation
import SokosumiChat
import Testing

private let ada = testUserSender(name: "Ada", email: "ada@example.com")
private let coworker = #"{"type":"coworker","coworker":{"id":"cow_1","name":"Elena","slug":"elena","caption":null,"image":null,"presence":"online"}}"#
private let deletedStamp = "2026-01-02T00:00:00.000Z"

/// Row 19a: web's `shouldKeepPersistedMessage` decides what a transcript shows.
/// Core's delete DTO has no body, quote, membership or metadata, so it is dropped.
@MainActor
struct DeletedMessageVisibilityTests {
  private func row(_ json: String) async throws -> Components.Schemas.ChatRoomMessage {
    try #require(try await fetchTestMessages([json]).first)
  }

  @Test func keepsWhatWebKeepsDespiteAnEmptyBody() async throws {
    #expect(try await shouldKeepPersistedMessage(row(testMessageJSON(id: "body", content: "Hello", sender: ada))))
    #expect(try await !shouldKeepPersistedMessage(row(testMessageJSON(id: "deleted", content: "", sender: ada, deletedAt: deletedStamp))))
    #expect(try await !shouldKeepPersistedMessage(row(testMessageJSON(id: "blank", content: " \\n ", sender: ada))))
    let membership = #"{"action":"joined","subject":{"type":"user","id":"user_2","name":"Ada"}}"#
    #expect(try await shouldKeepPersistedMessage(row(testMessageJSON(id: "joined", content: "", sender: ada, membership: membership))))
    var saved = try await row(testMessageJSON(id: "saved", content: "", sender: ada))
    saved.quote = .init(messageId: "source", authorName: "Ada", snippet: "Keep", roomId: "other-room")
    #expect(shouldKeepPersistedMessage(saved))
    let thinking = #"{"streaming":true,"mention_id":"mention_1","in_reply_to_message_id":"source"}"#
    let failed = #"{"mention_id":"mention_1","mention_failed":true,"in_reply_to_message_id":"source"}"#
    #expect(try await shouldKeepPersistedMessage(row(testMessageJSON(id: "thinking", content: "", sender: coworker, metadata: thinking))))
    #expect(try await shouldKeepPersistedMessage(row(testMessageJSON(id: "failed", content: "", sender: coworker, metadata: failed))))
    // Shell metadata on a human sender, or a coworker row without it, is an empty row like any other.
    #expect(try await !shouldKeepPersistedMessage(row(testMessageJSON(id: "human", content: "", sender: ada, metadata: thinking))))
    #expect(try await !shouldKeepPersistedMessage(row(testMessageJSON(id: "bare", content: "", sender: coworker, metadata: #"{"mention_id":""}"#))))
  }

  @Test func historyLoadDropsDeletedRowsFromDisplayButKeepsThemInState() async throws {
    let transport = TestTransport([(200, testMessagesPageBody(messages: [
      testMessageJSON(id: "first", content: "First", sender: ada, createdAt: "2026-01-01T00:00:00.000Z"),
      testMessageJSON(id: "gone", content: "", sender: ada, createdAt: "2026-01-01T00:01:00.000Z", deletedAt: deletedStamp),
      testMessageJSON(id: "last", content: "Last", sender: ada, createdAt: "2026-01-01T00:02:00.000Z")
    ], nextCursor: nil))])
    let timeline = RoomTimeline()
    timeline.reset(roomId: testRoomId)
    _ = try await timeline.loadPage(.initial, client: makeTestClient(transport), organizationSlug: nil, generation: timeline.generation)
    #expect(timeline.messages.map(\.id) == ["first", "gone", "last"])
    #expect(displayedTranscript(messages: timeline.messages, shells: []).map(\.id) == ["first", "last"])
  }

  @Test func realtimeDeleteRemovesAnExistingRowFromDisplay() async throws {
    let rows = try await fetchTestMessages([
      testMessageJSON(id: "first", content: "First", sender: ada, createdAt: "2026-01-01T00:00:00.000Z"),
      testMessageJSON(id: "target", content: "Bye", sender: ada, createdAt: "2026-01-01T00:01:00.000Z")
    ])
    #expect(displayedTranscript(messages: rows, shells: []).map(\.id) == ["first", "target"])
    let deleted = try await row(testMessageJSON(id: "target", content: "", sender: ada, createdAt: "2026-01-01T00:01:00.000Z", deletedAt: deletedStamp))
    let full = applyRealtimeFullEvent(messages: rows, shells: [], eventType: .delete, message: deleted).messages
    #expect(full.map(\.id) == ["first", "target"])
    #expect(displayedTranscript(messages: full, shells: []).map(\.id) == ["first"])
    // The id-only envelope path tombstones in place and leaves display the same way.
    let now = Date(timeIntervalSince1970: 1_700_000_000)
    let enveloped = applyRealtimeTombstone(messages: rows, messageId: "target", now: now)
    #expect(enveloped.first { $0.id == "target" }?.deletedAt == now)
    #expect(displayedTranscript(messages: enveloped, shells: []).map(\.id) == ["first"])
  }

  @Test func threadDropsADeletedReplyAndKeepsADeletedRootTombstone() async throws {
    var root = try await row(testMessageJSON(id: "root", content: "Parent", sender: ada))
    root.threadReplyCount = 2
    let reply = { (id: String, content: String, deletedAt: String?) in
      testMessageJSON(id: id, content: content, sender: ada, deletedAt: deletedAt)
        .replacingOccurrences(of: "\"parentMessageId\":null", with: "\"parentMessageId\":\"root\"")
    }
    let transport = TestTransport([(200, testMessagesPageBody(messages: [
      reply("reply-gone", "", deletedStamp), reply("reply-live", "Still here", nil)
    ], nextCursor: nil))])
    let session = ThreadSession()
    #expect(session.open(root))
    _ = try await session.timeline.loadPage(.initial, client: makeTestClient(transport), organizationSlug: nil, generation: session.timeline.generation)
    #expect(session.timeline.messages.count == 2)
    #expect(session.displayedReplies.map(\.id) == ["reply-live"])

    let deletedReply = try await row(reply("reply-live", "", deletedStamp))
    session.apply(eventType: .delete, message: deletedReply)
    #expect(session.displayedReplies.isEmpty)

    // Web filters replies only; the root above the divider keeps its tombstone.
    let now = Date(timeIntervalSince1970: 1_700_000_000)
    session.apply(eventType: .delete, message: tombstoneTranscriptMessage(root, now: now))
    #expect(session.parent?.id == "root")
    #expect(session.parent?.deletedAt == now)
    #expect(session.parent?.content.isEmpty == true)
  }
}

import CoreAPI
import Foundation
@testable import SokosumiChat
import Testing

@MainActor
struct ThreadSessionTests {
  private let sender = Components.Schemas.ChatRoomUserParticipant(id: "me", name: "Me", email: "me@example.com", presence: .online)
  private func parent() async throws -> Components.Schemas.ChatRoomMessage {
    let rows = try await fetchTestMessages([
      testMessageJSON(id: "root", content: "Parent", sender: testUserSender(name: "Ada", email: "ada@example.com"))
    ])
    return try #require(rows.first)
  }

  @Test func reopeningTheSameParentDoesNotResetTheTimeline() async throws {
    var root = try await parent()
    let session = ThreadSession()
    #expect(session.open(root))
    let generation = session.transcript.timeline.generation
    root.content = "Edited parent"
    #expect(session.open(root))
    #expect(session.transcript.timeline.generation == generation)
    #expect(session.parent?.content == "Edited parent")
  }

  @Test func parentAndReplyEventsHaveIndependentDestinations() async throws {
    var root = try await parent()
    let session = ThreadSession()
    #expect(session.open(root))
    #expect(session.transcript.timeline.isLoading)
    var reply = root
    reply.id = "reply"
    reply.parentMessageId = root.id
    reply.content = "Reply"
    session.apply(eventType: .create, message: reply)
    session.apply(eventType: .create, message: reply)
    root.content = "Edited parent"
    session.apply(eventType: .update, message: root)
    #expect(session.parent?.content == "Edited parent")
    #expect(session.transcript.displayedMessages.map(\.id) == ["reply"])
    reply.parentMessageId = "other"
    reply.content = "Other thread"
    session.apply(eventType: .update, message: reply)
    #expect(session.transcript.displayedMessages.first?.content == "Reply")
    #expect(!session.open(reply))
    #expect(session.parent?.id == root.id)
  }

  @Test func patchesAndDeleteEnvelopesKeepRootOutOfReplies() async throws {
    let now = Date(timeIntervalSince1970: 1_700_000_000)
    let root = try await parent()
    let session = ThreadSession(now: { now })
    session.open(root)
    var reply = root
    reply.id = "reply"
    reply.parentMessageId = root.id
    session.apply(eventType: .create, message: reply)
    session.apply(.init(roomId: testRoomId, messageId: root.id, parentMessageId: nil, value: .unfurls([])))
    #expect(session.parent?.unfurls != nil)
    #expect(session.transcript.timeline.messages.first?.unfurls == nil)
    let hydrateRoot = session.apply(ChatRoomMessageIdEnvelope(eventType: .update, messageId: root.id, roomId: testRoomId))
    #expect(hydrateRoot)
    session.apply(ChatRoomMessageIdEnvelope(eventType: .delete, messageId: "reply", roomId: testRoomId, parentMessageId: root.id))
    #expect(session.transcript.timeline.messages.first?.deletedAt == now)
    #expect(session.parent?.deletedAt == nil)
    session.apply(ChatRoomMessageIdEnvelope(eventType: .delete, messageId: root.id, roomId: testRoomId))
    #expect(session.parent?.deletedAt == now)
    #expect(session.transcript.timeline.messages.map(\.id) == ["reply"])
    session.close()
    session.apply(eventType: .create, message: reply)
    #expect(session.parent == nil)
    #expect(session.transcript.displayedMessages.isEmpty)
  }

  @Test func hardDeletedParentClosesThreadWhileSoftDeleteKeepsPreview() async throws {
    var root = try await parent()
    let session = ThreadSession()
    session.open(root)
    root.deletedAt = Date()
    session.apply(eventType: .delete, message: root)
    #expect(session.parent?.deletedAt != nil)
    root.deletedAt = nil
    session.apply(eventType: .delete, message: root)
    #expect(session.parent == nil)
    #expect(session.transcript.timeline.roomId == nil)
  }

  @Test func threadLookUsesCurrentParentAndDoesNotIssueRoomReadItself() async throws {
    let root = try await parent()
    let session = ThreadSession()
    session.open(root)
    let transport = TestTransport([(200, """
    {"data":{"parentMessageId":"root","lastReadAt":"\(testTimestamp)"},"meta":{"timestamp":"\(testTimestamp)","requestId":"test"}}
    """)])
    let looked = try await session.markLooked(client: makeTestClient(transport), organizationSlug: "acme")
    #expect(looked)
    #expect(transport.requests.map(\.operationID) == ["post/chats/rooms/{id}/threads/{parentMessageId}/read"])
    #expect(session.transcript.timeline.isLoading)
  }

  @Test func replySendQueuesAndUpdatesParentAfterConfirmation() async throws {
    let root = try await parent()
    let replyBody = testCreatedMessageBody(id: "reply", content: "Reply", clientMessageId: "unused")
      .replacingOccurrences(of: "\"parentMessageId\":null", with: "\"parentMessageId\":\"root\"")
    let transport = TestTransport([
      (200, testMessagesPageBody(messages: [], nextCursor: nil)),
      (201, replyBody)
    ])
    let client = try makeTestClient(transport)
    let session = ThreadSession()
    session.open(root)
    _ = try await session.transcript.timeline.loadPage(.initial, client: client, organizationSlug: nil, generation: session.transcript.timeline.generation)
    var confirmations = 0
    let accepted = session.send("Reply", client: client, organizationSlug: nil, sender: sender,
                                settled: { result in
                                  switch result {
                                  case .success: confirmations += 1
                                  case .failure: Issue.record("Unexpected send error")
                                  }
                                })
    #expect(accepted)
    #expect(session.transcript.displayedMessages.first?.parentMessageId == root.id)
    while session.transcript.outbox.isSending {
      await Task.yield()
    }
    #expect(confirmations == 1)
    #expect(session.transcript.outbox.shells.isEmpty)
    #expect(session.transcript.timeline.messages.map(\.id) == ["reply"])
    #expect(session.parent?.threadReplyCount == 1)
    #expect(try testRequestJSON(#require(transport.bodies.last))["parentMessageId"] as? String == "root")
  }

  @Test func replyCountsWhenRealtimeEchoArrivesBeforeHTTPResponse() async throws {
    let root = try await parent()
    let replyBody = testCreatedMessageBody(id: "reply", content: "Reply", clientMessageId: "unused")
      .replacingOccurrences(of: "\"parentMessageId\":null", with: "\"parentMessageId\":\"root\"")
    let client = try makeTestClient(TestTransport([(201, replyBody)]))
    let session = ThreadSession()
    session.open(root)
    var confirmations = 0
    session.send("Reply", client: client, organizationSlug: nil, sender: sender,
                 settled: {
                   if case .success = $0 {
                     confirmations += 1
                   }
                 })
    // Core publishes before it returns 201, so the echo usually wins.
    var echo = try chatRoomMessage(from: #require(session.transcript.outbox.shells.first))
    echo.id = "reply"
    session.apply(eventType: .create, message: echo)
    #expect(session.transcript.outbox.shells.isEmpty)
    while session.transcript.outbox.isSending {
      await Task.yield()
    }
    #expect(confirmations == 1)
    #expect(session.transcript.timeline.messages.map(\.id) == ["reply"])
    #expect(session.parent?.threadReplyCount == 1)
  }

  @Test func failedReplyRetryKeepsClientIdAndDoesNotIncrementParentEarly() async throws {
    let root = try await parent()
    let replyBody = testCreatedMessageBody(id: "reply", content: "Reply", clientMessageId: "unused")
      .replacingOccurrences(of: "\"parentMessageId\":null", with: "\"parentMessageId\":\"root\"")
    let transport = TestTransport([
      (200, testMessagesPageBody(messages: [], nextCursor: nil)),
      (500, """
      {"error":"Failure","message":"try again","meta":{"timestamp":"\(testTimestamp)","requestId":"test","path":"/messages","method":"POST"}}
      """),
      (201, replyBody)
    ])
    let client = try makeTestClient(transport)
    let session = ThreadSession()
    session.open(root)
    _ = try await session.transcript.timeline.loadPage(.initial, client: client, organizationSlug: nil, generation: session.transcript.timeline.generation)
    var failures = 0
    session.send("Reply", client: client, organizationSlug: "acme", sender: sender,
                 settled: {
                   if case .failure = $0 {
                     failures += 1
                   }
                 })
    while session.transcript.outbox.isSending {
      await Task.yield()
    }
    #expect(failures == 1)
    #expect(session.parent?.threadReplyCount == 0)
    let failed = try #require(session.transcript.outbox.shells.first)
    #expect(failed.status == .failed)
    session.transcript.outbox.retry(failed.clientTurnId)
    while session.transcript.outbox.isSending {
      await Task.yield()
    }
    #expect(session.parent?.threadReplyCount == 1)
    #expect(transport.bodies[1] == transport.bodies[2])
  }
}

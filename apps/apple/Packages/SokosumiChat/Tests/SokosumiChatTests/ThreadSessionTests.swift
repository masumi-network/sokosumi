import CoreAPI
import Foundation
import SokosumiChat
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
    let generation = session.timeline.generation
    root.content = "Edited parent"
    #expect(session.open(root))
    #expect(session.timeline.generation == generation)
    #expect(session.parent?.content == "Edited parent")
  }

  @Test func parentAndReplyEventsHaveIndependentDestinations() async throws {
    var root = try await parent()
    let session = ThreadSession()
    #expect(session.open(root))
    #expect(session.timeline.isLoading)
    var reply = root
    reply.id = "reply"
    reply.parentMessageId = root.id
    reply.content = "Reply"
    session.apply(eventType: .create, message: reply)
    session.apply(eventType: .create, message: reply)
    root.content = "Edited parent"
    session.apply(eventType: .update, message: root)
    #expect(session.parent?.content == "Edited parent")
    #expect(session.displayedReplies.map(\.id) == ["reply"])
    reply.parentMessageId = "other"
    reply.content = "Other thread"
    session.apply(eventType: .update, message: reply)
    #expect(session.displayedReplies.first?.content == "Reply")
    #expect(!session.open(reply))
    #expect(session.parent?.id == root.id)
  }

  @Test func patchesAndDeleteEnvelopesKeepRootOutOfReplies() async throws {
    let root = try await parent()
    let session = ThreadSession()
    session.open(root)
    var reply = root
    reply.id = "reply"
    reply.parentMessageId = root.id
    session.apply(eventType: .create, message: reply)
    session.apply(.init(roomId: testRoomId, messageId: root.id, parentMessageId: nil, value: .unfurls([])))
    #expect(session.parent?.unfurls != nil)
    #expect(session.timeline.messages.first?.unfurls == nil)
    let hydrateRoot = session.apply(ChatRoomMessageIdEnvelope(eventType: .update, messageId: root.id, roomId: testRoomId))
    #expect(hydrateRoot)
    session.apply(ChatRoomMessageIdEnvelope(eventType: .delete, messageId: "reply", roomId: testRoomId, parentMessageId: root.id))
    #expect(session.timeline.messages.first?.deletedAt != nil)
    #expect(session.parent?.deletedAt == nil)
    session.apply(ChatRoomMessageIdEnvelope(eventType: .delete, messageId: root.id, roomId: testRoomId))
    #expect(session.parent?.deletedAt != nil)
    #expect(session.timeline.messages.map(\.id) == ["reply"])
    session.close()
    session.apply(eventType: .create, message: reply)
    #expect(session.parent == nil)
    #expect(session.displayedReplies.isEmpty)
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
    #expect(session.timeline.roomId == nil)
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
    #expect(session.timeline.isLoading)
  }

  @Test func pageLoadingOrdersAttentionAndStopsWhenThreadCloses() async throws {
    let session = ThreadSession()
    let root = try await parent()
    let transport = TestTransport([
      (200, testMessagesPageBody(messages: [], nextCursor: nil)),
      (200, testMessagesPageBody(messages: [], nextCursor: nil))
    ])
    let client = try makeTestClient(transport)
    session.open(root)
    var requestCounts: [Int] = []
    let attention = { requestCounts.append(transport.requests.count) }
    let failed: (Error) -> Void = { Issue.record("Unexpected page failure: \($0)") }
    session.loadPage(.initial, client: client, organizationSlug: nil,
                     syncAttention: attention, failed: failed)
    await session.loadTask?.value
    session.loadPage(.latest, client: client, organizationSlug: nil,
                     syncAttention: attention, failed: failed)
    await session.loadTask?.value
    #expect(requestCounts == [0, 2])
    #expect(session.timeline.hasLoadedHistory)
    #expect(session.loadTask == nil)

    session.open(root)
    session.loadPage(.initial, client: client, organizationSlug: nil,
                     syncAttention: { session.close() }, failed: failed)
    let pending = session.loadTask
    await pending?.value
    #expect(session.parent == nil)
    #expect(transport.requests.count == 2)
    #expect(session.loadTask == nil)
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
    _ = try await session.timeline.loadPage(.initial, client: client, organizationSlug: nil, generation: session.timeline.generation)
    var confirmations = 0
    let accepted = session.send("Reply", client: client, organizationSlug: nil, sender: sender,
                                settled: { result in
                                  switch result {
                                  case .success: confirmations += 1
                                  case .failure: Issue.record("Unexpected send error")
                                  }
                                })
    #expect(accepted)
    #expect(session.displayedReplies.first?.parentMessageId == root.id)
    while session.outbox.isSending {
      await Task.yield()
    }
    #expect(confirmations == 1)
    #expect(session.outbox.shells.isEmpty)
    #expect(session.timeline.messages.map(\.id) == ["reply"])
    #expect(session.parent?.threadReplyCount == 1)
    #expect(session.parent?.threadLastReplyAt != nil)
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
    var echo = try chatRoomMessage(from: #require(session.outbox.shells.first))
    echo.id = "reply"
    session.apply(eventType: .create, message: echo)
    #expect(session.outbox.shells.isEmpty)
    while session.outbox.isSending {
      await Task.yield()
    }
    #expect(confirmations == 1)
    #expect(session.timeline.messages.map(\.id) == ["reply"])
    #expect(session.parent?.threadReplyCount == 1)
  }

  @Test func openThreadAcceptsReplyWhileHistoryLoadsButRejectsEmptyText() async throws {
    let transport = TestTransport([(201, testCreatedMessageBody(id: "reply", content: "Reply", clientMessageId: "unused")
        .replacingOccurrences(of: "\"parentMessageId\":null", with: "\"parentMessageId\":\"root\""))])
    let client = try makeTestClient(transport)
    let session = ThreadSession()
    let closedSend = session.send("Reply", client: client, organizationSlug: nil, sender: sender, settled: { _ in })
    #expect(!closedSend)
    try await session.open(parent())
    #expect(session.timeline.isLoading)
    let emptySend = session.send(" \n", client: client, organizationSlug: nil, sender: sender, settled: { _ in })
    #expect(!emptySend)
    let accepted = session.send("Reply", client: client, organizationSlug: nil, sender: sender, settled: { _ in })
    #expect(accepted)
    while session.outbox.isSending {
      await Task.yield()
    }
    #expect(session.timeline.messages.map(\.id) == ["reply"])
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
    _ = try await session.timeline.loadPage(.initial, client: client, organizationSlug: nil, generation: session.timeline.generation)
    var failures = 0
    session.send("Reply", client: client, organizationSlug: "acme", sender: sender,
                 settled: {
                   if case .failure = $0 {
                     failures += 1
                   }
                 })
    while session.outbox.isSending {
      await Task.yield()
    }
    #expect(failures == 1)
    #expect(session.parent?.threadReplyCount == 0)
    let failed = try #require(session.outbox.shells.first)
    #expect(failed.status == .failed)
    session.outbox.retry(failed.clientTurnId)
    while session.outbox.isSending {
      await Task.yield()
    }
    #expect(session.parent?.threadReplyCount == 1)
    #expect(transport.bodies[1] == transport.bodies[2])
  }
}

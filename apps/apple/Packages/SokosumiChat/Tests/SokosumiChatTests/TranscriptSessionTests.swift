import Combine
import CoreAPI
import Foundation
@testable import SokosumiChat
import Testing

@MainActor
struct TranscriptSessionTests {
  private let sender = Components.Schemas.ChatRoomUserParticipant(id: "me", name: "Me", email: "me@example.com", presence: .online)
  private func parent() async throws -> Components.Schemas.ChatRoomMessage {
    let rows = try await fetchTestMessages([
      testMessageJSON(id: "root", content: "Parent", sender: testUserSender(name: "Ada", email: "ada@example.com"))
    ])
    return try #require(rows.first)
  }

  /// A context-loaded reply may still be awaiting Markdown preparation after the hold would have expired.
  @Test func aPendingJumpDoesNotExpireBeforeItsRowIsReady() async throws {
    let requested = Date(timeIntervalSince1970: 1_800_000_000)
    var now = requested
    let session = TranscriptSession(now: { now })
    let message = try await parent()
    session.timeline.messages = [message]
    session.requestJump(to: message.id)
    let target = try #require(session.jumpTarget)
    now = requested.addingTimeInterval(6)
    session.endJumpIfMarkEnded()
    #expect(session.jumpTarget?.requestId == target.requestId)
    #expect(session.jumpTarget?.mark == nil)
    session.readerScrolled()
    #expect(session.jumpTarget?.requestId == target.requestId)
    session.landJump(target.requestId)
    #expect(session.jumpTarget?.mark?.landedAt == now)
    now = now.addingTimeInterval(4.4)
    session.endJumpIfMarkEnded()
    #expect(session.jumpTarget?.requestId == target.requestId)
    now = now.addingTimeInterval(0.1)
    session.endJumpIfMarkEnded()
    #expect(session.jumpTarget == nil)
  }

  @Test func onlyTheCurrentJumpCanLandAndOnlyOnce() async throws {
    let requested = Date(timeIntervalSince1970: 1_800_000_000)
    var now = requested
    let session = TranscriptSession(now: { now })
    let message = try await parent()
    session.timeline.messages = [message]
    session.requestJump(to: message.id)
    let first = try #require(session.jumpTarget)
    session.requestJump(to: message.id)
    let replacement = try #require(session.jumpTarget)
    session.landJump(first.requestId)
    #expect(session.jumpTarget?.mark == nil)
    session.landJump(replacement.requestId)
    let landed = session.jumpTarget
    now = now.addingTimeInterval(1)
    session.landJump(replacement.requestId)
    #expect(session.jumpTarget == landed)
  }

  /// Row 25b1: a jump carries its mark from the landing; a reader scroll at full strength hands it to
  /// the leave fade without moving the jump, a scroll in either end of the hold ends it, and the jump is dropped
  /// once the mark has run out.
  @Test func theJumpEndsWithItsMark() async throws {
    let landed = Date(timeIntervalSince1970: 1_800_000_000)
    var now = landed
    let session = TranscriptSession(now: { now })
    let message = try await parent()
    session.timeline.messages = [message]

    session.requestJump(to: message.id)
    try session.landJump(#require(session.jumpTarget).requestId)
    let target = try #require(session.jumpTarget)
    #expect(target.mark == JumpMark(messageId: message.id, landedAt: landed))
    now = landed.addingTimeInterval(4.4)
    session.endJumpIfMarkEnded()
    #expect(session.jumpTarget == target)
    now = landed.addingTimeInterval(4.5)
    session.endJumpIfMarkEnded()
    #expect(session.jumpTarget == nil)

    session.requestJump(to: message.id)
    let second = try #require(session.jumpTarget)
    #expect(second.requestId != target.requestId)
    session.landJump(second.requestId)
    now = landed.addingTimeInterval(5.5)
    session.readerScrolled()
    let leaving = try #require(session.jumpTarget)
    #expect(leaving.requestId == second.requestId)
    #expect(leaving.mark?.leftAt == now)
    session.readerScrolled()
    #expect(session.jumpTarget == leaving)
    now = now.addingTimeInterval(0.32)
    session.endJumpIfMarkEnded()
    #expect(session.jumpTarget == nil)

    session.requestJump(to: message.id)
    try session.landJump(#require(session.jumpTarget).requestId)
    now = now.addingTimeInterval(0.2)
    session.readerScrolled()
    #expect(session.jumpTarget == nil)
  }

  @Test func clearingJumpPublishesOnlyWhenTargetChanges() async throws {
    let session = TranscriptSession()
    let message = try await parent()
    session.timeline.messages = [message]
    var changes = 0
    let observation = session.objectWillChange.sink { changes += 1 }
    defer { observation.cancel() }

    session.clearJump()
    #expect(changes == 0)
    session.requestJump(to: message.id)
    #expect(changes == 1)
    session.clearJump()
    #expect(session.jumpTarget == nil)
    #expect(changes == 2)
    session.clearJump()
    #expect(changes == 2)
  }

  @Test func pageLoadingOrdersAttentionAndStopsWhenTheTranscriptCloses() async throws {
    let session = TranscriptSession()
    let root = try await parent()
    let transport = TestTransport([
      (200, testMessagesPageBody(messages: [], nextCursor: nil)),
      (200, testMessagesPageBody(messages: [], nextCursor: nil))
    ])
    let client = try makeTestClient(transport)
    session.open(roomId: root.roomId, parentMessageId: root.id)
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

    session.open(roomId: root.roomId, parentMessageId: root.id)
    session.loadPage(.initial, client: client, organizationSlug: nil,
                     syncAttention: { session.close() }, failed: failed)
    let pending = session.loadTask
    await pending?.value
    #expect(session.timeline.roomId == nil)
    #expect(transport.requests.count == 2)
    #expect(session.loadTask == nil)
  }

  @Test func sendUsesInjectedTurnIdAndNow() async throws {
    let now = Date(timeIntervalSince1970: 1_788_868_800)
    let root = try await parent()
    let transport = TestTransport([
      (201, testCreatedMessageBody(id: "reply", content: "Reply", clientMessageId: "turn-fixed")
        .replacingOccurrences(of: "\"parentMessageId\":null", with: "\"parentMessageId\":\"root\""))
    ])
    let client = try makeTestClient(transport)
    let session = TranscriptSession(now: { now }, makeId: { "turn-fixed" })
    session.open(roomId: root.roomId, parentMessageId: root.id)
    #expect(session.send("Reply", client: client, organizationSlug: nil, sender: sender, settled: { _ in }))
    #expect(session.displayedMessages.map(\.id) == [outboundLocalMessageId("turn-fixed")])
    #expect(session.displayedMessages.first?.createdAt == now)
    while session.outbox.isSending {
      await Task.yield()
    }
    #expect(try testRequestJSON(#require(transport.bodies.last))["clientMessageId"] as? String == "turn-fixed")
    #expect(session.timeline.messages.map(\.id) == ["reply"])
  }

  /// Row 42: a Thread reply carries its skills like a room send (web `handleThreadSend`).
  @Test func aReplyCarriesItsSkillsToCoreAndOnItsShell() async throws {
    let root = try await parent()
    let transport = TestTransport([
      (201, testCreatedMessageBody(id: "reply", content: "Reply", clientMessageId: "turn-skills")
        .replacingOccurrences(of: "\"parentMessageId\":null", with: "\"parentMessageId\":\"root\""))
    ])
    let client = try makeTestClient(transport)
    let session = TranscriptSession(makeId: { "turn-skills" })
    session.open(roomId: root.roomId, parentMessageId: root.id)
    let skill = Components.Schemas.ChatRoomMessageSkill(id: "a/b/c", name: "c", description: nil, url: "https://skills.sh/a/b/c")
    #expect(session.send("Reply", client: client, organizationSlug: nil, sender: sender, skills: [skill], settled: { _ in }))
    #expect(session.displayedMessages.first?.skills == [skill])
    while session.outbox.isSending {
      await Task.yield()
    }
    #expect(try testRequestJSON(#require(transport.bodies.last))["skillIds"] as? [String] == ["a/b/c"])
  }

  @Test func anOpenTranscriptAcceptsASendWhileHistoryLoadsButRejectsEmptyText() async throws {
    let transport = TestTransport([(201, testCreatedMessageBody(id: "reply", content: "Reply", clientMessageId: "unused")
        .replacingOccurrences(of: "\"parentMessageId\":null", with: "\"parentMessageId\":\"root\""))])
    let client = try makeTestClient(transport)
    let session = TranscriptSession()
    let closedSend = session.send("Reply", client: client, organizationSlug: nil, sender: sender, settled: { _ in })
    #expect(!closedSend)
    let root = try await parent()
    session.open(roomId: root.roomId, parentMessageId: root.id)
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

  /// Opening a scope resets the timeline once, so a load captures the only new generation.
  @Test func openingResetsTheTimelineOnce() {
    let session = TranscriptSession()
    session.open(roomId: testRoomId)
    let opened = session.timeline.generation
    session.open(roomId: "other-room")
    #expect(session.timeline.generation == opened + 1)
    #expect(session.timeline.roomId == "other-room")
  }

  /// A room Transcript sends without a parent and keeps Thread replies out of its history.
  @Test func aRoomTranscriptKeepsRepliesOut() async throws {
    let transport = TestTransport([(201, testCreatedMessageBody(id: "sent", content: "Hello", clientMessageId: "turn-room"))])
    let client = try makeTestClient(transport)
    let session = TranscriptSession(makeId: { "turn-room" })
    session.open(roomId: testRoomId)
    #expect(session.send("Hello", client: client, organizationSlug: nil, sender: sender, settled: { _ in }))
    while session.outbox.isSending {
      await Task.yield()
    }
    #expect(try testRequestJSON(#require(transport.bodies.last))["parentMessageId"] as? String == nil)
    #expect(session.timeline.messages.map(\.id) == ["sent"])
    var reply = try #require(session.timeline.messages.first)
    reply.id = "reply"
    reply.parentMessageId = "sent"
    session.apply(eventType: .create, message: reply)
    #expect(session.timeline.messages.map(\.id) == ["sent"])
  }
}

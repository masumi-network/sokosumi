import CoreAPI
import Foundation
@testable import SokosumiChat
import Testing

/// The Unread divider (spec SOK-1481): the room opens through Core's open-at-unread mode, holds the divider Core named
/// for the visit, and draws it above that message, or the next loaded one once it is deleted.
@MainActor
struct UnreadDividerTests {
  private let reader = Components.Schemas.ChatRoomUserParticipant(id: "me", name: "Me", email: "me@example.com", presence: .online)

  /// Message `index` of the room, one minute after the previous one.
  private func message(_ index: Int, content: String? = nil) -> String {
    let minute = String(format: "%02d", index % 60)
    let hour = String(format: "%02d", index / 60)
    return testMessageJSON(id: id(index), content: content ?? "Message \(index)", sender: testUserSender(name: "Ada", email: "ada@example.com"),
                           createdAt: "2026-01-01T\(hour):\(minute):00.000Z")
  }

  private func id(_ index: Int) -> String {
    "m\(String(format: "%03d", index))"
  }

  private func page(_ range: ClosedRange<Int>, nextCursor: String? = nil, total: Int? = nil, firstUnread: String?? = .none) -> (Int, String) {
    (200, testMessagesPageBody(messages: range.map { message($0) }, nextCursor: nextCursor, total: total, firstUnreadMessageId: firstUnread))
  }

  private func openedSession(_ responses: [(Int, String)], atUnreadDivider: Bool = true) async throws -> (TranscriptSession, TestTransport) {
    let transport = TestTransport(responses)
    let client = try makeTestClient(transport)
    let session = TranscriptSession(makeId: { "turn" })
    session.open(roomId: testRoomId, atUnreadDivider: atUnreadDivider)
    session.hooks = .init(access: { (client, nil) }, failed: { Issue.record("Unexpected page failure: \($0)")
      return false
    }, pageLanded: { _ in })
    #expect(await session.load(.initial)?.value == true)
    return (session, transport)
  }

  /// The ids of the rows the divider sits above, as the list lays them out.
  private func dividerRows(_ session: TranscriptSession) -> [String] {
    let messages = session.displayedMessages
    let dividerId = session.unreadDividerRowId(in: messages)
    let context = TranscriptContext(room: nil, viewerId: "me", allowsPins: false, allowsThreads: true, outbound: session.outbox.shells,
                                    editingMessageId: nil)
    return messages.indices.compactMap { index in
      session.row(at: index, of: messages, context: context, streamBusy: false, unreadDividerId: dividerId, now: Date()).startsUnread
        ? messages[index].id : nil
    }
  }

  @Test func aRoomOpensAtTheDividerOnItsNewestPage() async throws {
    let (session, transport) = try await openedSession([page(1 ... 10, firstUnread: id(7))])
    #expect(transport.requests.count == 1)
    #expect(testRequestQuery(transport.requests[0].request).contains("openAtUnread=true"))
    #expect(testRequestQuery(transport.requests[0].request).contains("limit=100"))
    #expect(session.timeline.unreadDividerMessageId == id(7))
    #expect(session.placesUnreadDivider)
    #expect(dividerRows(session) == [id(7)])
    #expect(session.timeline.historicalAnchor == nil)
  }

  /// Core answered with the window around an older divider: the newest page loads next and the two join through the
  /// gap row, and the list reaches the present, so Jump to latest only scrolls.
  @Test func anOlderDividerJoinsTheNewestPageThroughTheGapRow() async throws {
    let (session, transport) = try await openedSession([
      page(37 ... 70, nextCursor: id(37), total: 300, firstUnread: id(40)),
      page(201 ... 300, nextCursor: id(201), total: 300, firstUnread: id(40))
    ])
    #expect(transport.requests.count == 2)
    #expect(!testRequestQuery(transport.requests[1].request).contains("openAtUnread"))
    #expect(session.timeline.messages.map(\.id) == (37 ... 70).map(id) + (201 ... 300).map(id))
    #expect(session.timeline.historyGapMessageIds == [id(201)])
    #expect(session.timeline.cursor == id(37))
    #expect(session.timeline.historicalAnchor == nil)
    #expect(dividerRows(session) == [id(40)])
    #expect(session.placesUnreadDivider)
    #expect(try await session.returnToLatest())
    #expect(transport.requests.count == 2)
  }

  /// Realtime arrivals, the reader's own post and later pages naming another first unread message (or none, after a
  /// read) leave the divider where the visit opened it. Edits do not move it either.
  @Test func theDividerIsFixedForTheVisit() async throws {
    let (session, transport) = try await openedSession([
      page(1 ... 10, firstUnread: id(7)),
      (201, testCreatedMessageBody(id: "sent", content: "Mine", clientMessageId: "turn")),
      page(1 ... 12, firstUnread: .some(nil))
    ])
    let client = try makeTestClient(transport)
    let arrival = try #require(await fetchTestMessages([message(11)]).first)
    session.apply(eventType: .create, message: arrival)
    #expect(session.send("Mine", client: client, organizationSlug: nil, sender: reader, settled: { _ in }))
    while session.outbox.isSending {
      await Task.yield()
    }
    session.update(id(7)) { edited in
      var edited = edited
      edited.content = "Edited"
      return edited
    }
    #expect(await session.load(.latest)?.value == true)
    #expect(session.timeline.unreadDividerMessageId == id(7))
    #expect(dividerRows(session) == [id(7)])
  }

  /// A deleted divider message hands the divider to the next loaded message after it; with none after it, it goes.
  @Test func deletingTheDividerMessageMovesItToTheNextLoadedMessage() async throws {
    let (session, _) = try await openedSession([page(1 ... 10, firstUnread: id(8))])
    session.apply(ChatRoomMessageIdEnvelope(eventType: .delete, messageId: id(8), roomId: testRoomId))
    #expect(dividerRows(session) == [id(9)])
    session.apply(ChatRoomMessageIdEnvelope(eventType: .delete, messageId: id(9), roomId: testRoomId))
    session.apply(ChatRoomMessageIdEnvelope(eventType: .delete, messageId: id(10), roomId: testRoomId))
    #expect(dividerRows(session).isEmpty)
  }

  /// Opening another room ends the visit; the next visit takes Core's answer afresh, so a room read meanwhile opens
  /// with no divider, at its newest message.
  @Test func aVisitEndsWhenAnotherRoomOpens() async throws {
    let transport = TestTransport([page(1 ... 10, firstUnread: id(7)), page(1 ... 10, firstUnread: .some(nil))])
    let client = try makeTestClient(transport)
    let session = TranscriptSession()
    session.hooks = .init(access: { (client, nil) }, failed: { _ in false }, pageLanded: { _ in })
    session.open(roomId: testRoomId, atUnreadDivider: true)
    _ = await session.load(.initial)?.value
    #expect(session.timeline.unreadDividerMessageId == id(7))
    session.open(roomId: "other-room", atUnreadDivider: true)
    #expect(session.timeline.unreadDividerMessageId == nil)
    #expect(!session.placesUnreadDivider)
    session.open(roomId: testRoomId, atUnreadDivider: true)
    _ = await session.load(.initial)?.value
    #expect(session.timeline.unreadDividerMessageId == nil)
    #expect(!session.placesUnreadDivider)
    #expect(dividerRows(session).isEmpty)
  }

  /// An explicit target wins: the room opens without the open-at-unread mode and does not place the divider, yet
  /// draws it from the first unread message its own page names once that message is loaded. A jump later in the visit
  /// replaces a placement still waiting.
  @Test func anExplicitTargetWinsOverTheDivider() async throws {
    let (session, transport) = try await openedSession([page(1 ... 10, firstUnread: id(4))], atUnreadDivider: false)
    #expect(!testRequestQuery(transport.requests[0].request).contains("openAtUnread"))
    #expect(!session.placesUnreadDivider)
    #expect(dividerRows(session) == [id(4)])

    let (placing, _) = try await openedSession([page(1 ... 10, firstUnread: id(4))])
    #expect(placing.placesUnreadDivider)
    placing.requestJump(to: id(2))
    #expect(!placing.placesUnreadDivider)
    #expect(dividerRows(placing) == [id(4)])
  }

  /// A divider message an explicit target's page did not load draws nothing until a page brings it.
  @Test func aDividerMessageNotLoadedDrawsNothing() async throws {
    let (session, _) = try await openedSession([page(201 ... 300, nextCursor: id(201), total: 300, firstUnread: id(40))], atUnreadDivider: false)
    #expect(session.timeline.unreadDividerMessageId == id(40))
    #expect(dividerRows(session).isEmpty)
  }

  /// No Room unread (Marked unread alone included: Core answers null) opens as today, at the newest message.
  @Test func aRoomWithoutRoomUnreadOpensWithNoDivider() async throws {
    let (session, transport) = try await openedSession([page(1 ... 10, firstUnread: .some(nil))])
    #expect(transport.requests.count == 1)
    #expect(session.timeline.unreadDividerMessageId == nil)
    #expect(!session.placesUnreadDivider)
    #expect(dividerRows(session).isEmpty)
  }

  /// The Thread panel never shows a divider: its Transcript never asks for one.
  @Test func aThreadNeverOpensAtADivider() async throws {
    let transport = TestTransport([(200, testMessagesPageBody(messages: [], nextCursor: nil, firstUnreadMessageId: id(3)))])
    let client = try makeTestClient(transport)
    let session = TranscriptSession()
    session.open(roomId: testRoomId, parentMessageId: "root", atUnreadDivider: true)
    session.hooks = .init(access: { (client, nil) }, failed: { _ in false }, pageLanded: { _ in })
    _ = await session.load(.initial)?.value
    #expect(transport.requests.count == 1)
    #expect(!testRequestQuery(transport.requests[0].request).contains("openAtUnread"))
    #expect(session.timeline.unreadDividerMessageId == nil)
    #expect(!session.placesUnreadDivider)
  }
}

import CoreAPI
import Foundation
@testable import SokosumiChat
import Testing

/// What resets with the Open room: opening another room or closing it starts the next visit clean, while reopening
/// the open room keeps what still describes it.
@MainActor
struct OpenRoomSessionTests {
  private let viewer = Components.Schemas.ChatRoomUserParticipant(id: "me", name: "Me", email: "me@example.com", presence: .online)

  private func room(_ id: String, coworker: Bool = false) -> Components.Schemas.ChatRoom {
    .init(id: id, name: id, kind: coworker ? .direct : .channel, isSelfDirect: false, isGroupDirect: false, isReadOnly: false,
          createdByUserId: "me", createdAt: Date(timeIntervalSince1970: 0), updatedAt: Date(timeIntervalSince1970: 0),
          unreadCount: 0, unreadMentionCount: 0, markedUnread: false, myAccess: .init(value1: .member, value2: "member"),
          userMembers: [viewer], formerUserMembers: [],
          coworkerMembers: coworker ? [.init(id: "coworker", name: "Coworker", slug: "coworker", presence: .online)] : [],
          sokoBotMembers: [])
  }

  /// A session on room `a` with a visit's worth of state: a jump, an overview request, live health, a pin in flight
  /// and an open Thread.
  private func visited() async throws -> OpenRoomSession {
    let session = OpenRoomSession()
    session.open(room("a"), userId: "me", organizationId: nil)
    let parent = try #require(try await fetchTestMessages([testMessageJSON(id: "parent", content: "Parent", sender: testUserSender(name: "Ada", email: "ada@example.com"))]).first)
    session.thread.open(parent)
    session.requestJump(to: "parent")
    session.requestThreadOverview(roomId: "a")
    session.applyRealtimeHealth(true, continuityLost: false)
    _ = session.startPinChange("parent")
    return session
  }

  @Test func openingAnotherRoomStartsTheVisitClean() async throws {
    let session = try await visited()
    let navigation = session.navigationRequest
    let generation = session.room.timeline.generation
    session.open(room("b"), userId: "me", organizationId: nil)
    #expect(session.room.timeline.roomId == "b")
    #expect(session.room.timeline.generation != generation, "Results started for room a turn stale.")
    #expect(session.navigationRequest != navigation)
    #expect(session.messageJump == nil)
    #expect(session.threadOverviewRequest == nil)
    #expect(!session.realtimeHealthy)
    #expect(session.pendingPins.isEmpty)
    #expect(session.thread.parent == nil)
    #expect(session.pins.roomId == "b")
  }

  /// Try again on a failed first page reopens the open room: its socket is still healthy and the overview it was
  /// asked for still belongs to it.
  @Test func reopeningTheOpenRoomKeepsItsHealthAndOverviewRequest() async throws {
    let session = try await visited()
    session.open(room("a"), userId: "me", organizationId: nil)
    #expect(session.realtimeHealthy)
    #expect(session.threadOverviewRequest?.roomId == "a")
    #expect(session.messageJump == nil)
    #expect(session.thread.parent == nil)
  }

  /// The sidebar asks for a room's overview before that room opens.
  @Test func anOverviewRequestWaitsForTheRoomItNames() throws {
    let session = OpenRoomSession()
    session.open(room("a"), userId: "me", organizationId: nil)
    session.requestThreadOverview(roomId: "b")
    session.open(room("b"), userId: "me", organizationId: nil)
    let request = try #require(session.threadOverviewRequest)
    #expect(request.roomId == "b")
    session.consumeThreadOverviewRequest(UUID())
    #expect(session.threadOverviewRequest == request, "Only its own id consumes it.")
    session.consumeThreadOverviewRequest(request.requestId)
    #expect(session.threadOverviewRequest == nil)
  }

  @Test func closingLeavesNothingOpen() async throws {
    let session = try await visited()
    session.close()
    #expect(session.room.timeline.roomId == nil)
    #expect(session.pins.roomId == nil)
    #expect(session.directStream.roomId == nil)
    #expect(session.threadOverviewRequest == nil)
    #expect(!session.realtimeHealthy)
    #expect(session.thread.parent == nil)
    session.requestJump(to: "parent")
    #expect(session.messageJump == nil, "No room to land in.")
  }

  @Test func onlyACoworkerDirectRunsTheStream() {
    let session = OpenRoomSession()
    session.open(room("direct", coworker: true), userId: "me", organizationId: nil)
    #expect(session.directStream.roomId == "direct")
    session.open(room("channel"), userId: "me", organizationId: nil)
    #expect(session.directStream.roomId == nil)
  }

  @Test func aPinTakesOneChangeAtATime() {
    let session = OpenRoomSession()
    session.open(room("a"), userId: "me", organizationId: nil)
    #expect(session.startPinChange("m1"))
    #expect(!session.startPinChange("m1"), "A second change waits for the first.")
    session.finishPinChange("m1")
    #expect(session.startPinChange("m1"))
  }

  @Test func aJumpIsConsumedOnlyByItsOwnRequest() {
    let session = OpenRoomSession()
    session.open(room("a"), userId: "me", organizationId: nil)
    session.requestJump(to: "m1", isThreadParent: true)
    let jump = session.messageJump
    #expect(jump?.roomId == "a")
    #expect(jump?.isThreadParent == true)
    session.consumeMessageJump(UUID())
    #expect(session.messageJump == jump)
    session.consumeMessageJump(jump?.requestId ?? UUID())
    #expect(session.messageJump == nil)
  }

  // MARK: - Routes through the session

  /// A session on Core through `transport`; `rejected` hears every failure the workspace would see.
  private func connected(_ transport: TestTransport, rejected: @escaping (Error) -> Void = { _ in }) throws -> OpenRoomSession {
    let client = try makeTestClient(transport)
    let session = OpenRoomSession(sleep: { _ in try await Task.sleep(for: .seconds(3600)) })
    session.hooks = .init(access: { (client, nil) }, failed: { error in
      rejected(error)
      return false
    }, pageLanded: {}, lookBeforeThread: {}, isForeground: { false })
    return session
  }

  private let ada = testUserSender(name: "Ada", email: "ada@example.com")

  /// The Thread's reply bar lives on the room's copy of the parent, so a confirmed reply reaches the room too.
  @Test func aConfirmedReplyCountsOnTheRoomsParent() async throws {
    let reply = testCreatedMessageBody(id: "reply", content: "Reply", clientMessageId: "unused")
      .replacingOccurrences(of: "\"parentMessageId\":null", with: "\"parentMessageId\":\"root\"")
    let session = try connected(TestTransport([
      (200, testMessagesPageBody(messages: [testMessageJSON(id: "root", content: "Root", sender: ada)], nextCursor: nil)),
      (200, testMessagesPageBody(messages: [], nextCursor: nil)),
      (201, reply)
    ]))
    session.open(room(testRoomId), userId: "me", organizationId: nil)
    _ = await session.room.loadTask?.value
    try session.openThread(#require(session.room.timeline.messages.first))
    _ = await session.thread.transcript.loadTask?.value
    #expect(session.sendReply("Reply", sender: viewer, mentions: []))
    while session.thread.transcript.outbox.isSending {
      await Task.yield()
    }
    #expect(session.room.timeline.messages.first?.threadReplyCount == 1)
  }

  /// A rejected send reaches the workspace, which signs a dead session out.
  @Test func aFailedSendReachesTheWorkspace() async throws {
    var failures = 0
    let session = try connected(TestTransport([
      (200, testMessagesPageBody(messages: [], nextCursor: nil)),
      (500, #"{"message":"offline"}"#)
    ]), rejected: { _ in failures += 1 })
    session.open(room(testRoomId), userId: "me", organizationId: nil)
    _ = await session.room.loadTask?.value
    let draft = ComposerContent("Hello")
    #expect(session.canSend(draft, quoted: false))
    #expect(session.send(draft, sender: viewer, mentions: []))
    while session.room.outbox.isSending {
      await Task.yield()
    }
    #expect(failures == 1)
  }

  /// A draft the room refuses leaves a jumped-to page where it is.
  @Test func aRefusedDraftKeepsTheJumpedToPage() async throws {
    let transport = TestTransport([
      (200, testMessagesPageBody(messages: [], nextCursor: nil)),
      (200, testMessagesPageBody(messages: [testMessageJSON(id: "m1", content: "Old", sender: ada)], nextCursor: "m1"))
    ])
    let session = try connected(transport)
    session.open(room(testRoomId), userId: "me", organizationId: nil)
    _ = await session.room.loadTask?.value
    _ = try await session.room.timeline.loadPage(.around("m1"), client: makeTestClient(transport), organizationSlug: nil,
                                                 generation: session.room.timeline.generation)
    try #require(session.room.timeline.historicalAnchor == "m1")
    #expect(!session.send(ComposerContent(" \n"), sender: viewer, mentions: []))
    #expect(session.room.timeline.historicalAnchor == "m1")
  }

  /// The room's latest page carries the newer copy of an open Thread's parent.
  @Test func theRoomsLatestPageRefreshesTheThreadsParent() async throws {
    let session = try connected(TestTransport([
      (200, testMessagesPageBody(messages: [testMessageJSON(id: "root", content: "Root", sender: ada)], nextCursor: nil)),
      (200, testMessagesPageBody(messages: [], nextCursor: nil)),
      (200, testMessagesPageBody(messages: [testMessageJSON(id: "root", content: "Edited", sender: ada)], nextCursor: nil))
    ]))
    session.open(room(testRoomId), userId: "me", organizationId: nil)
    _ = await session.room.loadTask?.value
    try session.openThread(#require(session.room.timeline.messages.first))
    _ = await session.thread.transcript.loadTask?.value
    session.refresh()
    _ = await session.room.loadTask?.value
    #expect(session.thread.parent?.content == "Edited")
  }

  /// An envelope for the open room is the room's; one for another room is left to the workspace's sidebar.
  @Test func anEnvelopeForAnotherRoomIsLeftToTheWorkspace() async throws {
    let session = try connected(TestTransport([
      (200, testMessagesPageBody(messages: [testMessageJSON(id: "root", content: "Root", sender: ada)], nextCursor: nil)),
      (200, testMessagesPageBody(messages: [], nextCursor: nil))
    ]))
    session.open(room(testRoomId), userId: "me", organizationId: nil)
    _ = await session.room.loadTask?.value
    #expect(session.apply(ChatRoomMessageIdEnvelope(eventType: .delete, messageId: "root", roomId: testRoomId)))
    #expect(session.room.timeline.messages.first?.deletedAt != nil)
    #expect(!session.apply(ChatRoomMessageIdEnvelope(eventType: .create, messageId: "m1", roomId: "elsewhere")))
  }

  /// A live message for another room never lands in the open room's history.
  @Test func aMessageForAnotherRoomStaysOutOfTheRoom() async throws {
    let session = try connected(TestTransport([(200, testMessagesPageBody(messages: [], nextCursor: nil))]))
    session.open(room(testRoomId), userId: "me", organizationId: nil)
    _ = await session.room.loadTask?.value
    let elsewhere = try #require(try await fetchTestMessages([testMessageJSON(id: "m1", content: "Hi", sender: ada, roomId: "elsewhere")]).first)
    session.apply(eventType: .create, message: elsewhere, roomId: "elsewhere")
    #expect(session.room.timeline.messages.isEmpty)
    let here = try #require(try await fetchTestMessages([testMessageJSON(id: "m2", content: "Hi", sender: ada)]).first)
    session.apply(eventType: .create, message: here, roomId: testRoomId)
    #expect(session.room.timeline.messages.map(\.id) == ["m2"])
  }
}

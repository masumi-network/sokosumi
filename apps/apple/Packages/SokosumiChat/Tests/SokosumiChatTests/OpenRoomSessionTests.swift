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
    session.pendingPins = ["parent"]
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
  private func connected(_ transport: TestTransport, rejected: @escaping (Error) -> Void = { _ in }, synced: @escaping () -> Void = {}) throws -> OpenRoomSession {
    let client = try makeTestClient(transport)
    let session = OpenRoomSession(sleep: { _ in try await Task.sleep(for: .seconds(3600)) })
    session.hooks = .init(access: { (client, nil) }, failed: { error in
      rejected(error)
      return false
    }, pageLanded: synced, lookBeforeThread: {}, isForeground: { false }, listedRoom: { [self] in room(testRoomId) },
    viewer: { ("me", "Me") }, organizationId: { nil })
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

  // MARK: - The runner

  /// Core answering after the room changed answers a visit that is over: neither its result nor its failure lands.
  @Test func anAnswerForAnEarlierVisitIsDropped() async throws {
    var failures = 0
    let session = try connected(TestTransport([(200, testMessagesPageBody(messages: [], nextCursor: nil))]), rejected: { _ in failures += 1 })
    session.open(room(testRoomId), userId: "me", organizationId: nil)
    let value = try await session.request(signIn: "Log in.") { _, _, _ in
      session.open(room("b"), userId: "me", organizationId: nil)
      return 1
    }
    #expect(value == nil)
    let failure = try await session.request(signIn: "Log in.") { _, _, _ -> Int in
      session.open(room("c"), userId: "me", organizationId: nil)
      throw ChatServiceError.unauthorized("Expired")
    }
    #expect(failure == nil, "Not rethrown to a view that moved on.")
    #expect(failures == 1, "A rejected session still signs out.")
  }

  /// A Pending reaction is not the visit's: its answer still lands after the room changed.
  @Test func workOutlivingTheVisitKeepsItsAnswer() async throws {
    let session = try connected(TestTransport([(200, testMessagesPageBody(messages: [], nextCursor: nil))]))
    session.open(room(testRoomId), userId: "me", organizationId: nil)
    let value = try await session.request(signIn: "Log in.", outlivingTheVisit: true) { _, _, _ in
      session.open(room("b"), userId: "me", organizationId: nil)
      return 1
    }
    #expect(value == 1)
  }

  @Test func aCurrentFailureReachesTheCaller() async throws {
    let session = try connected(TestTransport([(200, testMessagesPageBody(messages: [], nextCursor: nil))]))
    session.open(room(testRoomId), userId: "me", organizationId: nil)
    await #expect(throws: ChatServiceError.self) {
      _ = try await session.request(signIn: "Log in.") { _, _, _ -> Int in throw ChatServiceError.unexpectedResponse("boom") }
    }
  }

  @Test func withoutAClientTheRequestAsksToSignIn() async throws {
    let session = OpenRoomSession()
    session.open(room("a"), userId: "me", organizationId: nil)
    await #expect(throws: ChatServiceError.unauthorized("Log in to delete messages.")) {
      _ = try await session.request(signIn: "Log in to delete messages.") { _, _, _ in 1 }
    }
  }

  /// A pin change reports the room's new count for the sidebar and marks the row.
  @Test func aPinChangeReportsTheRoomsCount() async throws {
    let session = try connected(TestTransport([
      (200, testMessagesPageBody(messages: [testMessageJSON(id: "m1", content: "Hi", sender: ada)], nextCursor: nil)),
      (200, #"{"data":{"messageId":"m1","pinnedMessageCount":3},"meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"req"}}"#)
    ]))
    session.open(room(testRoomId), userId: "me", organizationId: nil)
    _ = await session.room.loadTask?.value
    #expect(try await session.setPinned(true, messageId: "m1") == 3)
    #expect(try session.isPinned(#require(session.room.timeline.messages.first)))
    #expect(!session.isUpdatingPin("m1"))
  }

  // MARK: - Navigation

  private func reply(_ id: String, to parentId: String) -> String {
    testMessageJSON(id: id, content: "Reply", sender: ada)
      .replacingOccurrences(of: "\"parentMessageId\":null", with: "\"parentMessageId\":\"\(parentId)\"")
  }

  /// A loaded row lands at once: the room marks it and no Thread stays over it.
  @Test func aLoadedMessageLandsInTheRoom() async throws {
    let session = try connected(TestTransport([
      (200, testMessagesPageBody(messages: [testMessageJSON(id: "root", content: "Root", sender: ada)], nextCursor: nil)),
      (200, testMessagesPageBody(messages: [], nextCursor: nil))
    ]))
    session.open(room(testRoomId), userId: "me", organizationId: nil)
    _ = await session.room.loadTask?.value
    try session.openThread(#require(session.room.timeline.messages.first))
    _ = await session.thread.transcript.loadTask?.value
    #expect(try await session.openMessage("root") == .opened)
    #expect(session.messageJump?.messageId == "root")
    #expect(session.thread.parent == nil)
  }

  /// Core refusing the lookup means the message is not the reader's to see; a rejected session reaches the caller.
  /// Every refusal goes to the `failed` hook, where the workspace signs a rejected session out.
  @Test(arguments: [(404, false), (403, false), (401, true)])
  func aRefusedLookupIsUnavailable(status: Int, reachesCaller: Bool) async throws {
    var failures = 0
    let session = try connected(TestTransport([
      (200, testMessagesPageBody(messages: [], nextCursor: nil)),
      (status, #"{"message":"No"}"#)
    ]), rejected: { _ in failures += 1 })
    session.open(room(testRoomId), userId: "me", organizationId: nil)
    _ = await session.room.loadTask?.value
    if reachesCaller {
      await #expect(throws: ChatServiceError.self) { _ = try await session.openMessage("gone") }
    } else {
      #expect(try await session.openMessage("gone") == .unavailable)
    }
    #expect(failures == 1)
    #expect(session.messageJump == nil)
  }

  /// A reply opens its parent's Thread, lands there, and marks the parent in the room behind it.
  @Test func aReplyOpensItsThreadAndMarksTheParent() async throws {
    let session = try connected(TestTransport([
      (200, testMessagesPageBody(messages: [testMessageJSON(id: "root", content: "Root", sender: ada)], nextCursor: nil)),
      (200, testMessagesPageBody(messages: [reply("r1", to: "root")], nextCursor: nil))
    ]))
    session.open(room(testRoomId), userId: "me", organizationId: nil)
    _ = await session.room.loadTask?.value
    let hit = try #require(try await fetchTestMessages([reply("r1", to: "root")]).first)
    #expect(try await session.openMessageReply(hit) == .opened)
    #expect(session.thread.parent?.id == "root")
    #expect(session.thread.transcript.jumpTarget?.messageId == "r1")
    #expect(session.messageJump?.messageId == "root")
    #expect(session.messageJump?.isThreadParent == true)
  }

  // MARK: - Thread attention and what the room shows

  /// The Threads trigger counts again when the open room's Thread unread may have moved, and only then.
  @Test func threadAttentionMovesForTheOpenRoomsReplies() async throws {
    let session = try connected(TestTransport([(200, testMessagesPageBody(messages: [], nextCursor: nil))]))
    session.open(room(testRoomId), userId: "me", organizationId: nil)
    _ = await session.room.loadTask?.value
    let top = try #require(try await fetchTestMessages([testMessageJSON(id: "top", content: "Top", sender: ada)]).first)
    let reply = try #require(try await fetchTestMessages([reply("r1", to: "top")]).first)
    var revision = session.threadAttentionRevision
    func moved() -> Bool {
      defer { revision = session.threadAttentionRevision }
      return session.threadAttentionRevision != revision
    }
    session.apply(eventType: .create, message: top, roomId: testRoomId)
    #expect(!moved(), "A top-level message is not Thread news.")
    session.apply(eventType: .create, message: reply, roomId: "elsewhere")
    #expect(!moved(), "Another room's reply is that room's.")
    session.apply(eventType: .create, message: reply, roomId: testRoomId)
    #expect(moved())
    session.apply(ChatRoomMessageIdEnvelope(eventType: .create, messageId: "m3", roomId: testRoomId))
    #expect(!moved(), "A top-level envelope is not Thread news.")
    session.apply(ChatRoomMessageIdEnvelope(eventType: .create, messageId: "r2", roomId: testRoomId, parentMessageId: "top"))
    #expect(moved())
    session.applyRealtimeHealth(true, continuityLost: false)
    #expect(!moved(), "Health alone changes no Thread.")
    session.applyRealtimeHealth(true, continuityLost: true)
    #expect(moved(), "Lost continuity may have missed replies.")
    session.threadAttentionChanged()
    #expect(moved())
  }

  /// A Pending reaction lists the reader under the name the open room gives them, else their account name; no name
  /// at all lists them unnamed.
  @Test(arguments: [("Ada in the room", "Ada Lovelace", "Ada in the room"), (nil, "Ada Lovelace", "Ada Lovelace"), (nil, "", nil)])
  func aPendingReactionNamesTheReaderAsTheRoomDoes(listed: String?, account: String, expected: String?) {
    let session = OpenRoomSession()
    var listedRoom = room(testRoomId)
    listedRoom.userMembers = listed.map { [.init(id: "me", name: $0, email: "me@example.com", presence: .online)] } ?? []
    session.hooks.listedRoom = { listedRoom }
    session.hooks.viewer = { ("me", account) }
    #expect(session.reactionViewer == PendingReactionViewer(id: "me", name: expected))
  }

  // MARK: - SOK-1484: the room reads only at the end of its transcript

  /// Opening puts nothing at the end; the list's report that it reached the end syncs the read, once, for the open room.
  @Test func reachingTheEndSyncsTheRead() async throws {
    var syncs = 0
    let session = try connected(TestTransport([(200, testMessagesPageBody(messages: [], nextCursor: nil))]), synced: { syncs += 1 })
    session.open(room(testRoomId), userId: "me", organizationId: nil)
    _ = await session.room.loadTask?.value
    #expect(syncs == 1)
    #expect(!session.isAtEnd, "Opening the room does not put it at its end.")
    await session.setAtEnd(true, roomId: "other")
    #expect(!session.isAtEnd && syncs == 1, "Another room's list says nothing about this one.")
    await session.setAtEnd(true, roomId: testRoomId)
    #expect(session.isAtEnd && syncs == 2)
    await session.setAtEnd(true, roomId: testRoomId)
    await session.setAtEnd(false, roomId: testRoomId)
    #expect(syncs == 2, "Staying at the end or leaving it syncs nothing.")
    session.open(room("b"), userId: "me", organizationId: nil)
    #expect(!session.isAtEnd, "The next room starts away from its end.")
  }

  /// An explicit target holds the read from its start, through the first page, until its jump has moved the list off
  /// the end; the room reads once the reader is back at the end.
  @Test func anExplicitTargetHoldsTheReadUntilTheReaderIsBackAtTheEnd() async throws {
    var atEndWhenSynced: [Bool] = []
    var atEnd: () -> Bool = { false }
    let session = try connected(TestTransport([
      (200, testMessagesPageBody(messages: [testMessageJSON(id: "root", content: "Root", sender: ada)], nextCursor: nil))
    ]), synced: { atEndWhenSynced.append(atEnd()) })
    atEnd = { session.isAtEnd }
    session.open(room(testRoomId), userId: "me", organizationId: nil)
    await session.setAtEnd(true, roomId: testRoomId)
    #expect(try await session.openLinkTarget(roomId: testRoomId, messageId: "root") == .opened)
    #expect(atEndWhenSynced == [true, false, false], "Neither the first page nor the navigation's end reads the room.")
    // The room's list takes the jump and leaves the end.
    let jump = try #require(session.messageJump)
    session.room.requestJump(to: jump.messageId)
    session.consumeMessageJump(jump.requestId)
    await session.setAtEnd(false, roomId: testRoomId)
    #expect(!session.isAtEnd)
    await session.setAtEnd(true, roomId: testRoomId)
    #expect(atEndWhenSynced == [true, false, false, true], "Back at the end, the room reads.")
  }

  /// The list reports the end as it mounts, before it moves to the Unread divider: a room that opens at its divider
  /// reads nothing on open, while one with nothing unread still reads with its first page.
  @Test(arguments: [("m1", false), (nil, true)])
  func openingAtTheDividerReadsNothing(firstUnread: String?, readsOnOpen: Bool) async throws {
    var atEndWhenSynced: [Bool] = []
    var atEnd: () -> Bool = { false }
    let page = (200, testMessagesPageBody(messages: [testMessageJSON(id: "m1", content: "Unread", sender: ada)], nextCursor: nil,
                                          firstUnreadMessageId: .some(firstUnread)))
    // A divider's answer joins the newest page, read next.
    let session = try connected(TestTransport(firstUnread == nil ? [page] : [page, page]), synced: { atEndWhenSynced.append(atEnd()) })
    atEnd = { session.isAtEnd }
    session.open(room(testRoomId), userId: "me", organizationId: nil, atUnreadDivider: true)
    session.room.setAtEnd(true)
    _ = await session.room.loadTask?.value
    #expect(session.room.placesUnreadDivider == !readsOnOpen)
    #expect(atEndWhenSynced == [readsOnOpen], "The first page's read sync finds the room at its end only without a divider.")
  }

  /// A link without a message still holds the read through the first page, then releases it.
  @Test func aRoomLinkReadsOnceItsNavigationSettles() async throws {
    var atEndWhenSynced: [Bool] = []
    var atEnd: () -> Bool = { false }
    let session = try connected(TestTransport([(200, testMessagesPageBody(messages: [], nextCursor: nil))]),
                                synced: { atEndWhenSynced.append(atEnd()) })
    atEnd = { session.isAtEnd }
    session.open(room(testRoomId), userId: "me", organizationId: nil)
    await session.setAtEnd(true, roomId: testRoomId)
    #expect(try await session.openLinkTarget(roomId: testRoomId, messageId: nil) == .opened)
    #expect(atEndWhenSynced == [true, false, true])
  }
}

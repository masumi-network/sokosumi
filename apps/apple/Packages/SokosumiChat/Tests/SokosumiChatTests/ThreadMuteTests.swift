import CoreAPI
import Foundation
import HTTPTypes
import OpenAPIRuntime
import SokosumiChat
import Testing

private let mutedAt = "2026-09-23T12:00:00.000Z"
private let rootId = "550e8400-e29b-41d4-a716-446655440201"

/// One `ChatRoomThread` envelope for `rootId`, as Core's GET and mute routes answer.
private func threadBody(mutedAt: String?, unread: Int = 0) -> String {
  let parent = testMessageJSON(id: rootId, content: "Parent", sender: testUserSender(name: "Ada", email: "ada@example.com"))
  let muted = mutedAt.map { "\"\($0)\"" } ?? "null"
  return """
  {"data":{"parentMessage":\(parent),"replyCount":2,"lastReplyAt":"\(testTimestamp)","unreadReplyCount":\(unread),"lastUnreadReplyAt":null,"hasLooked":true,"mutedAt":\(muted)},"meta":{"timestamp":"\(testTimestamp)","requestId":"req-1"}}
  """
}

private func errorBody(_ status: Int, _ message: String) -> String {
  """
  {"error":"\(status)","message":"\(message)","meta":{"timestamp":"\(testTimestamp)","requestId":"req-1","path":"/v1/chats/rooms","method":"POST"}}
  """
}

/// Row 24b (ADR 0030, web `ThreadMuteButton`): given a thread's mute state and an event, the next state.
struct ThreadMuteStateTests {
  private func state(muted: Bool?) -> ThreadMuteState {
    var state = ThreadMuteState(roomId: testRoomId, parentMessageId: rootId)
    if let muted {
      state.read(mutedAt: muted ? Date(timeIntervalSince1970: 0) : nil)
    }
    return state
  }

  @Test func startsUnknownWithNoControlAndAsksForARead() {
    let state = state(muted: nil)
    #expect(state.isMuted == nil)
    #expect(state.needsRead)
    #expect(!state.isPending && state.failure == nil)
  }

  @Test(arguments: [false, true])
  func aReadMakesItKnownAndStopsFurtherReads(muted: Bool) {
    let state = state(muted: muted)
    #expect(state.isMuted == muted)
    #expect(!state.needsRead)
  }

  /// Web reads only while the state is unknown; a late read must not overwrite what the reader chose since.
  @Test func aLateReadCannotOverwriteAKnownState() {
    var state = state(muted: false)
    _ = state.beginToggle()
    state.read(mutedAt: nil)
    #expect(state.isMuted == true)
  }

  @Test(arguments: [false, true])
  func aToggleAnswersAtOnceAndBlocksASecondToggle(muted: Bool) {
    var state = state(muted: muted)
    #expect(state.beginToggle() == !muted)
    #expect(state.isMuted == !muted)
    #expect(state.isPending)
    var second = state
    #expect(second.beginToggle() == nil)
    #expect(second == state)
  }

  @Test func nothingToToggleWhileUnknown() {
    var state = state(muted: nil)
    #expect(state.beginToggle() == nil)
    #expect(state.isMuted == nil && !state.isPending)
  }

  /// Web test "settles on the state the write answered with": the optimistic value was only a guess.
  @Test func settlingTakesCoresAnswer() {
    var state = state(muted: false)
    _ = state.beginToggle()
    state.settle(mutedAt: nil)
    #expect(state.isMuted == false)
    #expect(!state.isPending && state.failure == nil)
  }

  @Test(arguments: [false, true])
  func aFailureRevertsAndSaysWhichWayItFailed(muted: Bool) {
    var state = state(muted: muted)
    _ = state.beginToggle()
    state.fail()
    #expect(state.isMuted == muted)
    #expect(!state.isPending)
    #expect(state.failure == (muted ? .unmute : .mute))
    #expect(state.failure?.message == (muted ? "Could not unmute this thread." : "Could not mute this thread."))
  }

  @Test func theNextToggleOrADismissClearsTheFailure() {
    var state = state(muted: false)
    _ = state.beginToggle()
    state.fail()
    var retried = state
    _ = retried.beginToggle()
    #expect(retried.failure == nil)
    state.dismissFailure()
    #expect(state.failure == nil && state.isMuted == false)
  }

  @Test func settleAndFailOutsideAWriteChangeNothing() {
    var state = state(muted: true)
    let before = state
    state.fail()
    #expect(state == before)
  }
}

/// The mute read keys off stored replies. A pending shell and the stored row that replaces it display as
/// one row, so the displayed count never moves again and a read started on the shell 404s for good.
struct LiveThreadReplyCountTests {
  private let sender = Components.Schemas.ChatRoomUserParticipant(id: "me", name: "Me", email: "me@example.com", presence: .online)

  @Test func aPendingShellAndAStreamOverlayAreNotReplies() {
    var parent = chatRoomMessage(from: OutboundShell(clientTurnId: "parent", roomId: testRoomId, content: "Parent", sender: sender))
    parent.id = "parent"
    let pending = chatRoomMessage(from: OutboundShell(
      clientTurnId: "turn", roomId: testRoomId, parentMessageId: "parent", content: "Reply", sender: sender
    ))
    var stream = pending
    stream.id = "stream:turn"
    var stored = pending
    stored.id = "reply"
    #expect(liveThreadReplyCount([parent, pending]) == 0)
    #expect(liveThreadReplyCount([parent, stream]) == 0)
    #expect(liveThreadReplyCount([parent, pending, stream, stored]) == 1)
    #expect([parent, pending].count == [parent, stored].count)
  }

  @Test @MainActor func confirmingTheFirstReplyLeavesTheDisplayedCountUnchanged() async throws {
    let rows = try await fetchTestMessages([
      testMessageJSON(id: rootId, content: "Parent", sender: testUserSender(name: "Ada", email: "ada@example.com"))
    ])
    let session = ThreadSession()
    #expect(try session.open(#require(rows.first)))
    let replyBody = testCreatedMessageBody(id: "reply", content: "Reply", clientMessageId: "unused")
      .replacingOccurrences(of: "\"parentMessageId\":null", with: "\"parentMessageId\":\"\(rootId)\"")
    let client = try makeTestClient(TestTransport([(201, replyBody)]))
    #expect(session.send("Reply", client: client, organizationSlug: nil, sender: sender, settled: { _ in }))
    let before = [session.parent].compactMap(\.self) + session.displayedReplies
    #expect(before.count == 2)
    #expect(liveThreadReplyCount(before) == 0)
    while session.outbox.isSending {
      await Task.yield()
    }
    let after = [session.parent].compactMap(\.self) + session.displayedReplies
    #expect(after.count == before.count)
    #expect(liveThreadReplyCount(after) == 1)
  }
}

/// The mute routes at the OpenAPI transport boundary.
struct ThreadMuteServiceTests {
  @Test(arguments: [true, false])
  func muteAndUnmuteSendTheirMethodAndDecodeTheThread(mute: Bool) async throws {
    let transport = TestTransport([(200, threadBody(mutedAt: mute ? mutedAt : nil))])
    let client = try makeTestClient(transport)
    let service = ChatService()
    let thread = mute
      ? try await service.muteThread(client: client, roomId: testRoomId, parentMessageId: rootId, organizationSlug: "acme")
      : try await service.unmuteThread(client: client, roomId: testRoomId, parentMessageId: rootId, organizationSlug: "acme")
    #expect((thread.mutedAt != nil) == mute)
    #expect(thread.parentMessage.id == rootId)
    let request = try #require(transport.requests.first?.request)
    #expect(request.method.rawValue == (mute ? "POST" : "DELETE"))
    #expect(request.path == "/chats/rooms/\(testRoomId)/threads/\(rootId)/mute")
    #expect(testOrgSlugHeader(request) == "acme")
  }

  @Test(arguments: [true, false], [401, 403, 404, 500])
  func failuresMapToChatServiceErrors(mute: Bool, status: Int) async throws {
    let transport = TestTransport([(status, errorBody(status, "Refused"))])
    let client = try makeTestClient(transport)
    let expected: ChatServiceError = status == 401 ? .unauthorized("Refused") : .unprocessable(statusCode: status, message: "Refused")
    await #expect(throws: expected) {
      if mute {
        _ = try await ChatService().muteThread(client: client, roomId: testRoomId, parentMessageId: rootId, organizationSlug: nil)
      } else {
        _ = try await ChatService().unmuteThread(client: client, roomId: testRoomId, parentMessageId: rootId, organizationSlug: nil)
      }
    }
  }
}

/// The open thread owns its mute state: read, toggle, revert and stale-response guards.
@MainActor
struct ThreadSessionMuteTests {
  private func openSession() async throws -> ThreadSession {
    let rows = try await fetchTestMessages([
      testMessageJSON(id: rootId, content: "Parent", sender: testUserSender(name: "Ada", email: "ada@example.com"))
    ])
    let session = ThreadSession()
    #expect(try session.open(#require(rows.first)))
    return session
  }

  @Test func openingAThreadStartsUnknownAndClosingDropsTheState() async throws {
    let session = try await openSession()
    #expect(session.mute == ThreadMuteState(roomId: testRoomId, parentMessageId: rootId))
    session.close()
    #expect(session.mute == nil)
  }

  @Test(arguments: [false, true])
  func readingAsksCoreOnceThenStops(muted: Bool) async throws {
    let transport = TestTransport([(200, threadBody(mutedAt: muted ? mutedAt : nil))])
    let client = try makeTestClient(transport)
    let session = try await openSession()
    try await session.readMute(client: client, organizationSlug: "acme")
    #expect(session.mute?.isMuted == muted)
    try await session.readMute(client: client, organizationSlug: "acme")
    #expect(transport.requests.map(\.operationID) == ["get/chats/rooms/{id}/threads/{parentMessageId}"])
    #expect(testOrgSlugHeader(transport.requests[0].request) == "acme")
  }

  /// A parent without a live reply is not a thread: Core answers 404, the state stays unknown and the next
  /// read (after the first reply lands) can still find it.
  @Test func aParentThatIsNotAThreadStaysUnknownUntilALaterRead() async throws {
    let transport = TestTransport([(404, errorBody(404, "Thread not found")), (200, threadBody(mutedAt: nil))])
    let client = try makeTestClient(transport)
    let session = try await openSession()
    await #expect(throws: ChatServiceError.unprocessable(statusCode: 404, message: "Thread not found")) {
      try await session.readMute(client: client, organizationSlug: nil)
    }
    #expect(session.mute?.isMuted == nil)
    #expect(session.mute?.failure == nil)
    try await session.readMute(client: client, organizationSlug: nil)
    #expect(session.mute?.isMuted == false)
  }

  @Test(arguments: [false, true])
  func aToggleSendsTheOppositeAndSettlesOnCoresAnswer(muted: Bool) async throws {
    let transport = TestTransport([
      (200, threadBody(mutedAt: muted ? mutedAt : nil)),
      (200, threadBody(mutedAt: muted ? nil : mutedAt))
    ])
    let client = try makeTestClient(transport)
    let session = try await openSession()
    try await session.readMute(client: client, organizationSlug: nil)
    #expect(try await session.toggleMute(client: client, organizationSlug: nil))
    #expect(session.mute?.isMuted == !muted)
    #expect(session.mute?.isPending == false)
    #expect(transport.requests.last?.operationID == "\(muted ? "delete" : "post")/chats/rooms/{id}/threads/{parentMessageId}/mute")
  }

  @Test func aFailedToggleRevertsAndKeepsTheFailure() async throws {
    let transport = TestTransport([(200, threadBody(mutedAt: nil)), (500, errorBody(500, "boom"))])
    let client = try makeTestClient(transport)
    let session = try await openSession()
    try await session.readMute(client: client, organizationSlug: nil)
    await #expect(throws: ChatServiceError.unprocessable(statusCode: 500, message: "boom")) {
      try await session.toggleMute(client: client, organizationSlug: nil)
    }
    #expect(session.mute?.isMuted == false)
    #expect(session.mute?.isPending == false)
    #expect(session.mute?.failure == .mute)
    session.dismissMuteFailure()
    #expect(session.mute?.failure == nil)
  }

  @Test func noRequestWhileUnknownOrPending() async throws {
    let held = HeldThreadTransport(body: threadBody(mutedAt: mutedAt))
    let client = try Client.connecting(to: #require(URL(string: "https://core.example/v1")), transport: held)
    let session = try await openSession()
    #expect(try await !session.toggleMute(client: client, organizationSlug: nil), "Nothing to toggle while unknown.")
    let reader = TestTransport([(200, threadBody(mutedAt: nil))])
    try await session.readMute(client: makeTestClient(reader), organizationSlug: nil)
    let first = Task { try await session.toggleMute(client: client, organizationSlug: nil) }
    await held.waitForRequest()
    #expect(session.mute?.isPending == true && session.mute?.isMuted == true)
    #expect(try await !session.toggleMute(client: client, organizationSlug: nil), "A second toggle waits for the first.")
    await held.release()
    #expect(try await first.value)
    #expect(await held.requestCount == 1)
    #expect(session.mute?.isMuted == true && session.mute?.isPending == false)
  }

  /// A write answering after the reader left for another thread says nothing about the new one, but Core
  /// did change: the caller still refreshes attention.
  @Test(arguments: [true, false])
  func aLateAnswerDoesNotTouchTheNextThread(succeeds: Bool) async throws {
    let held = HeldThreadTransport(body: succeeds ? threadBody(mutedAt: mutedAt) : errorBody(500, "boom"), status: succeeds ? 200 : 500)
    let client = try Client.connecting(to: #require(URL(string: "https://core.example/v1")), transport: held)
    let session = try await openSession()
    try await session.readMute(client: makeTestClient(TestTransport([(200, threadBody(mutedAt: nil))])), organizationSlug: nil)
    let write = Task { try await session.toggleMute(client: client, organizationSlug: nil) }
    await held.waitForRequest()
    var other = try #require(session.parent)
    other.id = "550e8400-e29b-41d4-a716-446655440202"
    #expect(session.open(other))
    await held.release()
    let result = await write.result
    if succeeds {
      #expect(try result.get())
    } else {
      #expect(throws: (any Error).self) { try result.get() }
    }
    #expect(session.mute == ThreadMuteState(roomId: testRoomId, parentMessageId: other.id))
  }

  @Test func aLateReadDoesNotTouchTheNextThread() async throws {
    let held = HeldThreadTransport(body: threadBody(mutedAt: mutedAt))
    let client = try Client.connecting(to: #require(URL(string: "https://core.example/v1")), transport: held)
    let session = try await openSession()
    let read = Task { try await session.readMute(client: client, organizationSlug: nil) }
    await held.waitForRequest()
    session.close()
    var other = try await fetchTestMessages([
      testMessageJSON(id: rootId, content: "Parent", sender: testUserSender(name: "Ada", email: "ada@example.com"))
    ]).first
    other?.content = "Reopened"
    #expect(try session.open(#require(other)))
    await held.release()
    try await read.value
    #expect(session.mute?.isMuted == nil, "The read belonged to the thread before it was closed.")
  }
}

/// Answers one request after the test releases it.
private actor HeldThreadTransport: ClientTransport {
  let body: String
  let status: Int
  private var waiter: CheckedContinuation<Void, Never>?
  private var observer: CheckedContinuation<Void, Never>?
  private var released = false
  private(set) var requestCount = 0

  init(body: String, status: Int = 200) {
    self.body = body
    self.status = status
  }

  func waitForRequest() async {
    if requestCount > 0 {
      return
    }
    await withCheckedContinuation { observer = $0 }
  }

  func release() {
    released = true
    waiter?.resume()
    waiter = nil
  }

  func send(_: HTTPRequest, body _: HTTPBody?, baseURL _: URL, operationID _: String) async throws -> (HTTPResponse, HTTPBody?) {
    requestCount += 1
    observer?.resume()
    observer = nil
    if !released {
      await withCheckedContinuation { waiter = $0 }
    }
    return (HTTPResponse(status: .init(code: status)), HTTPBody(body))
  }
}

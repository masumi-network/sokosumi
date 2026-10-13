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
    session.setRealtimeHealthy(true)
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
}

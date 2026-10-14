import CoreAPI
import Foundation
import HTTPTypes
import OpenAPIRuntime
@testable import SokosumiChat
import Testing

private let otherRoomId = "550e8400-e29b-41d4-a716-446655440102"

private func directoryRoomJSON(id: String = testRoomId, name: String = "general", pinned: Bool = false) -> String {
  let pin = pinned ? "\"\(testTimestamp)\"" : "null"
  return """
  {"id":"\(id)","organizationId":null,"organizationName":null,"name":"\(name)","slug":null,"kind":"channel","isSelfDirect":false,"directKey":null,"isGroupDirect":false,"isReadOnly":false,"formerUserMembers":[],"groupName":null,"topic":null,"discoverability":null,"createdByUserId":"user_1","createdAt":"\(testTimestamp)","updatedAt":"\(testTimestamp)","unreadCount":0,"unreadMentionCount":0,"starredAt":\(pin),"pinnedMessageCount":0,"mutedAt":null,"markedUnread":false,"myAccess":"member","peerInActiveOrganization":false,"userMembers":[],"coworkerMembers":[],"sokoBotMembers":[]}
  """
}

private func listBody(_ rooms: [String]) -> String {
  testMessagesPageBody(messages: rooms, nextCursor: nil)
}

private func actionBody(pinned: Bool) -> String {
  """
  {"data":\(directoryRoomJSON(pinned: pinned)),"meta":{"timestamp":"\(testTimestamp)","requestId":"action"}}
  """
}

/// Holds its one request until released.
private actor HeldTransport: ClientTransport {
  let response: String
  private var waiter: CheckedContinuation<Void, Never>?
  private var observer: CheckedContinuation<Void, Never>?

  init(response: String) {
    self.response = response
  }

  func waitForRequest() async {
    if waiter == nil {
      await withCheckedContinuation { observer = $0 }
    }
  }

  func release() {
    waiter?.resume()
    waiter = nil
  }

  func send(_: HTTPRequest, body _: HTTPBody?, baseURL _: URL, operationID _: String) async throws -> (HTTPResponse, HTTPBody?) {
    await withCheckedContinuation {
      waiter = $0
      observer?.resume()
      observer = nil
    }
    return (HTTPResponse(status: .ok), HTTPBody(response))
  }
}

@MainActor
struct ConversationSidebarDirectoryTests {
  private func sidebar(_ rooms: [String]) async throws -> ConversationSidebar {
    let sidebar = ConversationSidebar()
    try await sidebar.refresh(client: makeTestClient(TestTransport([(200, listBody(rooms))])), organizationSlug: nil)
    return sidebar
  }

  private func heldClient(_ transport: HeldTransport) throws -> Client {
    try Client.core(baseURL: #require(URL(string: "https://core.example/v1")), transport: transport)
  }

  private func room(_ json: String) async throws -> Components.Schemas.ChatRoom {
    try await sidebar([json]).rooms[0]
  }

  @Test func replaceKeepsALateListAnswerFromOverwritingIt() async throws {
    let state = try await sidebar([directoryRoomJSON(name: "before")])
    let edited = try await room(directoryRoomJSON(name: "edited"))
    let transport = HeldTransport(response: listBody([directoryRoomJSON(name: "before")]))
    let client = try heldClient(transport)
    let refresh = Task { try await state.refresh(client: client, organizationSlug: nil) }
    await transport.waitForRequest()
    #expect(state.isLoading)
    state.replace(edited)
    #expect(!state.isLoading)
    await transport.release()
    #expect(try await refresh.value == false)
    #expect(state.rooms.map(\.name) == ["edited"])
  }

  @Test func replaceLeavesAnUnlistedRoomUnlisted() async throws {
    let state = try await sidebar([directoryRoomJSON()])
    try await state.replace(room(directoryRoomJSON(id: otherRoomId, name: "other")))
    #expect(state.rooms.map(\.id) == [testRoomId])
  }

  @Test func updateWithoutInvalidationLeavesAListReadInFlightAlone() async throws {
    let state = try await sidebar([directoryRoomJSON(name: "before")])
    let transport = HeldTransport(response: listBody([directoryRoomJSON(name: "listed")]))
    let client = try heldClient(transport)
    let refresh = Task { try await state.refresh(client: client, organizationSlug: nil) }
    await transport.waitForRequest()
    #expect(state.update(testRoomId, invalidatingRefresh: false) { $0.pinnedMessageCount = 3 })
    #expect(state.rooms[0].pinnedMessageCount == 3)
    #expect(state.isLoading)
    await transport.release()
    #expect(try await refresh.value == true)
    #expect(state.rooms.map(\.name) == ["listed"])
  }

  @Test func updateWithInvalidationDropsAListReadInFlight() async throws {
    let state = try await sidebar([directoryRoomJSON(name: "before")])
    let transport = HeldTransport(response: listBody([directoryRoomJSON(name: "listed")]))
    let client = try heldClient(transport)
    let refresh = Task { try await state.refresh(client: client, organizationSlug: nil) }
    await transport.waitForRequest()
    #expect(state.update(testRoomId, invalidatingRefresh: true) { $0.name = "changed" })
    await transport.release()
    #expect(try await refresh.value == false)
    #expect(state.rooms.map(\.name) == ["changed"])
  }

  @Test func updateOfAnUnlistedRoomChangesNothingAndSaysSo() async throws {
    let state = try await sidebar([directoryRoomJSON()])
    #expect(!state.update(otherRoomId, invalidatingRefresh: false) { $0.name = "never" })
    #expect(state.rooms.map(\.name) == ["general"])
  }

  @Test func upsertAppendsANewRoomAndReplacesAListedOne() async throws {
    let state = try await sidebar([directoryRoomJSON(name: "first")])
    try await state.upsert(room(directoryRoomJSON(id: otherRoomId, name: "second")))
    #expect(state.rooms.map(\.name) == ["first", "second"])
    try await state.upsert(room(directoryRoomJSON(name: "renamed")))
    #expect(state.rooms.map(\.name) == ["renamed", "second"])
  }

  @Test func upsertLeavesAListReadInFlightAlone() async throws {
    let state = try await sidebar([directoryRoomJSON()])
    let transport = HeldTransport(response: listBody([directoryRoomJSON(), directoryRoomJSON(id: otherRoomId, name: "other")]))
    let client = try heldClient(transport)
    let refresh = Task { try await state.refresh(client: client, organizationSlug: nil) }
    await transport.waitForRequest()
    try await state.upsert(room(directoryRoomJSON(id: otherRoomId, name: "other")))
    await transport.release()
    #expect(try await refresh.value == true)
    #expect(state.rooms.map(\.id) == [testRoomId, otherRoomId])
  }

  @Test func revokeClearsTheSelectionWhenItIsTheRevokedRoom() async throws {
    let state = try await sidebar([directoryRoomJSON(), directoryRoomJSON(id: otherRoomId, name: "other")])
    state.selectedRoomId = testRoomId
    state.revoke(roomId: testRoomId)
    #expect(state.rooms.map(\.id) == [otherRoomId])
    #expect(state.selectedRoomId == nil)
  }

  @Test func revokeKeepsAnotherRoomsSelection() async throws {
    let state = try await sidebar([directoryRoomJSON(), directoryRoomJSON(id: otherRoomId, name: "other")])
    state.selectedRoomId = otherRoomId
    state.revoke(roomId: testRoomId)
    #expect(state.selectedRoomId == otherRoomId)
  }

  @Test func revokeDropsAListReadInFlight() async throws {
    let state = try await sidebar([directoryRoomJSON(), directoryRoomJSON(id: otherRoomId, name: "other")])
    let transport = HeldTransport(response: listBody([directoryRoomJSON(), directoryRoomJSON(id: otherRoomId, name: "other")]))
    let client = try heldClient(transport)
    let refresh = Task { try await state.refresh(client: client, organizationSlug: nil) }
    await transport.waitForRequest()
    state.revoke(roomId: testRoomId)
    await transport.release()
    #expect(try await refresh.value == false)
    #expect(state.rooms.map(\.id) == [otherRoomId])
  }

  @Test func revokeRollsBackTheRevokedRoomsPendingPinAndKeepsOthers() async throws {
    let state = try await sidebar([directoryRoomJSON(), directoryRoomJSON(id: otherRoomId, name: "other")])
    let revokedTransport = HeldTransport(response: actionBody(pinned: true))
    let revokedClient = try heldClient(revokedTransport)
    let revokedPin = Task {
      try await state.perform(.pin, roomId: testRoomId, client: revokedClient, organizationSlug: nil, clock: (now: Date(), makeId: UUID.init))
    }
    await revokedTransport.waitForRequest()
    #expect(state.isPending(roomId: testRoomId))
    let keptTransport = HeldTransport(response: actionBody(pinned: true))
    let keptClient = try heldClient(keptTransport)
    let keptMute = Task {
      try await state.perform(.mute, roomId: otherRoomId, client: keptClient, organizationSlug: nil, clock: (now: Date(), makeId: UUID.init))
    }
    await keptTransport.waitForRequest()

    state.revoke(roomId: testRoomId)
    #expect(!state.isPending(roomId: testRoomId))
    #expect(state.isPending(roomId: otherRoomId))
    #expect(state.rooms.map(\.id) == [otherRoomId])

    await revokedTransport.release()
    try await revokedPin.value
    await keptTransport.release()
    try await keptMute.value
    #expect(state.rooms.map(\.id) == [otherRoomId])
  }
}

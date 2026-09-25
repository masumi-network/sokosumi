import CoreAPI
import Foundation
@testable import SokosumiChat
import Testing

/// Fixed state + event → expected state. These fixtures freeze existing domain
/// behavior for future native implementations without a UI or live transport.
@MainActor
struct DomainGoldenTests {
  private let now = Date(timeIntervalSince1970: 1_700_000_000)

  @Test func transcriptTransitions() throws {
    let fixtures = try load([TranscriptFixture].self, name: "transcript")
    #expect(fixtures.count == 10)
    for fixture in fixtures {
      var shells = try fixture.shells.map { value in
        var shell = makeShell(parent: fixture.parent)
        shell.clientTurnId = value.id
        shell.status = try #require(OutboundDeliveryStatus(rawValue: value.status))
        shell.errorMessage = value.error
        return shell
      }
      var incoming = chatRoomMessage(from: makeShell(parent: fixture.incomingParent))
      incoming.id = "server-1"
      if fixture.incomingSenderId != "me" {
        incoming.metadata = nil
        incoming.sender = .case1(.init(_type: .user, user: .init(
          id: fixture.incomingSenderId, name: "Peer", email: "peer@example.com", presence: .online
        )))
      }
      var messages = fixture.messageIds.map { id in
        var message = incoming
        message.id = id
        return message
      }
      switch fixture.event {
      case .send:
        let outbox = RoomOutbox()
        let response = incoming
        outbox.enqueue(makeShell(parent: fixture.parent), send: { response }, confirmed: { _ in }, failed: { _ in })
        shells = outbox.shells
        outbox.reset()
      case .fail: shells = failOutbound(shells: shells, clientTurnId: "turn-1", errorMessage: "Offline")
      case .retry: shells = markOutboundPending(shells: shells, clientTurnId: "turn-1")
      case .ack:
        (messages, shells) = confirmOutbound(messages: messages, shells: shells, confirmed: incoming, clientTurnId: "turn-1")
      case .create:
        (messages, shells) = applyRealtimeFullEvent(messages: messages, shells: shells, eventType: .create,
                                                    message: incoming, parentMessageId: fixture.parent)
      case .delete:
        (messages, shells) = applyRealtimeFullEvent(messages: messages, shells: shells, eventType: .delete,
                                                    message: tombstoneTranscriptMessage(incoming, now: now), parentMessageId: fixture.parent)
      }
      let snapshot = TranscriptSnapshot(
        messageIds: messages.map(\.id),
        shells: shells.map { .init(id: $0.clientTurnId, status: $0.status.rawValue, error: $0.errorMessage) },
        displayIds: displayedTranscript(messages: messages, shells: shells).map(\.id)
      )
      #expect(snapshot == fixture.expected, "\(fixture.name)")
      #expect(messages.allSatisfy { ($0.content == "Hello" || $0.deletedAt == now) && $0.createdAt == now }, "\(fixture.name)")
    }
  }

  @Test func unreadTransitions() async throws {
    let fixtures = try load([UnreadFixture].self, name: "unread")
    #expect(fixtures.count == 2)
    for fixture in fixtures {
      let initial = TestTransport([(200, testMessagesPageBody(messages: [testAttentionRoomJSON(unread: fixture.initial)], nextCursor: nil))])
      let room = try #require(await ChatService().listRooms(client: makeTestClient(initial), organizationSlug: nil).first)
      let state = RoomReadAttention(now: { now })
      try state.setVisible(true, window: #require(UUID(uuidString: "00000000-0000-0000-0000-000000000001")))
      let body = """
      {"data":\(testAttentionRoomJSON(unread: fixture.response)),"meta":{"timestamp":"\(testTimestamp)","requestId":"golden"}}
      """
      let transport = TestTransport([(fixture.status, body)])
      var failed = false
      do {
        try await state.readIfNeeded(room: room, content: .init(messages: []), historyReadable: true,
                                     client: makeTestClient(transport), organizationSlug: nil)
      } catch {
        failed = true
      }
      #expect(failed == fixture.failed, "\(fixture.name)")
      #expect(state.applying(to: [room]).first?.unreadCount == fixture.expected, "\(fixture.name)")
      #expect(transport.requests.map(\.operationID) == ["post/chats/rooms/{id}/read"])
    }
  }

  private func makeShell(parent: String?) -> OutboundShell {
    .init(clientTurnId: "turn-1", roomId: testRoomId, parentMessageId: parent,
          content: "Hello", createdAt: now,
          sender: .init(id: "me", name: "Me", email: "me@example.com", presence: .online))
  }

  private func load<Value: Decodable>(_: Value.Type, name: String) throws -> Value {
    let url = try #require(Bundle.module.url(forResource: name, withExtension: "json", subdirectory: "Fixtures/Golden"))
    return try JSONDecoder().decode(Value.self, from: Data(contentsOf: url))
  }
}

private struct TranscriptFixture: Decodable {
  enum Event: String, Decodable { case send, fail, retry, ack, create, delete }
  let name: String
  let event: Event
  let shells: [ShellSnapshot]
  let messageIds: [String]
  let parent: String?
  let incomingParent: String?
  let incomingSenderId: String
  let expected: TranscriptSnapshot
}

private struct TranscriptSnapshot: Decodable, Equatable {
  let messageIds: [String]
  let shells: [ShellSnapshot]
  let displayIds: [String]
}

private struct ShellSnapshot: Decodable, Equatable {
  let id: String
  let status: String
  let error: String?
}

private struct UnreadFixture: Decodable {
  let name: String
  let status: Int
  let initial: Int
  let response: Int
  let expected: Int
  let failed: Bool
}

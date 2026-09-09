import CoreAPI
import Foundation
import SokosumiChat
import Testing

private let turnA = "turn-a"
private let turnB = "turn-b"
private let confirmedId = "550e8400-e29b-41d4-a716-446655440301"

private func testSender() -> Components.Schemas.ChatRoomUserParticipant {
  .init(id: "user_1", name: "Me", email: "me@example.com", presence: .offline)
}

private func shell(
  turn: String,
  content: String = "hello",
  status: OutboundDeliveryStatus = .pending
) -> OutboundShell {
  .init(
    clientTurnId: turn,
    roomId: testRoomId,
    content: content,
    createdAt: Date(timeIntervalSince1970: 1_788_868_800),
    status: status,
    sender: testSender()
  )
}

struct OutboundRoomMessageTests {
  @Test func pendingThenConfirmedReplacesShellInPlace() async throws {
    let pending = shell(turn: turnA)
    let history = try await fetchTestMessages([
      testMessageJSON(
        id: "550e8400-e29b-41d4-a716-446655440300",
        content: "earlier",
        sender: testUserSender(name: "Ada", email: "ada@example.com")
      )
    ])
    let confirmed = try await fetchTestMessages([
      testMessageJSON(
        id: confirmedId,
        content: "hello",
        sender: testUserSender(name: "Me", email: "me@example.com")
      )
    ])[0]
    let displayed = displayedTranscript(messages: history, shells: [pending])
    #expect(displayed.map(\.content) == ["earlier", "hello"])
    #expect(isOutboundLocalMessage(displayed[1]))
    #expect(displayed[1].id == outboundLocalMessageId(turnA))
    #expect(displayed[1].metadata?.additionalProperties["client_message_id"]?.value as? String == turnA)

    let result = confirmOutbound(
      messages: history,
      shells: [pending],
      confirmed: confirmed,
      clientTurnId: turnA
    )
    #expect(result.shells.isEmpty)
    #expect(result.messages.map(\.content) == ["earlier", "hello"])
    #expect(result.messages.map(\.id) == [
      "550e8400-e29b-41d4-a716-446655440300",
      confirmedId
    ])
    #expect(!isOutboundLocalMessage(result.messages[1]))
  }

  @Test func confirmOutboundReplacesExistingServerRow() async throws {
    let pending = shell(turn: turnA)
    let confirmed = try await fetchTestMessages([
      testMessageJSON(
        id: confirmedId,
        content: "hello",
        sender: testUserSender(name: "Me", email: "me@example.com")
      )
    ])[0]
    let result = confirmOutbound(
      messages: [confirmed],
      shells: [pending],
      confirmed: confirmed,
      clientTurnId: turnA
    )
    #expect(result.shells.isEmpty)
    #expect(result.messages.map(\.id) == [confirmedId])
  }

  @Test func unresolvedShellStaysAfterConfirmedBlock() async throws {
    let pending = shell(turn: turnA)
    let failed = shell(turn: turnB, content: "later", status: .failed)
    let confirmed = try await fetchTestMessages([
      testMessageJSON(
        id: confirmedId,
        content: "hello",
        sender: testUserSender(name: "Me", email: "me@example.com")
      )
    ])[0]
    let result = confirmOutbound(
      messages: [],
      shells: [pending, failed],
      confirmed: confirmed,
      clientTurnId: turnA
    )
    #expect(result.shells.map(\.clientTurnId) == [turnB])
    #expect(result.shells[0].status == .failed)
    let displayed = displayedTranscript(messages: result.messages, shells: result.shells)
    #expect(displayed.map(\.content) == ["hello", "later"])
    #expect(!isOutboundLocalMessage(displayed[0]))
    #expect(isOutboundLocalMessage(displayed[1]))
  }

  @Test func pendingThenFailedRetryAndRemove() {
    var flight = ClassicOutboundFlight()
    let first = flight.begin(turnA)
    #expect(first)
    var shells = [shell(turn: turnA)]
    flight.end(turnA)
    shells = failOutbound(shells: shells, clientTurnId: turnA, errorMessage: "Core rejected the request (500): boom")
    #expect(shells[0].status == .failed)
    #expect(shells[0].errorMessage == "Core rejected the request (500): boom")
    #expect(!flight.isInFlight)

    let retry = flight.begin(turnA)
    #expect(retry)
    shells = markOutboundPending(shells: shells, clientTurnId: turnA)
    #expect(shells[0].status == .pending)
    #expect(shells[0].errorMessage == nil)
    #expect(shells[0].clientTurnId == turnA)

    flight.end(turnA)
    shells = failOutbound(shells: shells, clientTurnId: turnA, errorMessage: "boom")
    shells = removeOutbound(shells: shells, clientTurnId: turnA)
    #expect(shells.isEmpty)
  }

  @Test func oneInFlightSendOccupiesTheSlot() {
    var flight = ClassicOutboundFlight()
    let first = flight.begin(turnA)
    #expect(first)
    #expect(flight.isInFlight)
    let second = flight.begin(turnB)
    #expect(!second)
    #expect(flight.clientMessageId == turnA)
    flight.end(turnB)
    #expect(flight.isInFlight)
    flight.end(turnA)
    #expect(!flight.isInFlight)
    let third = flight.begin(turnB)
    #expect(third)
  }
}

import CoreAPI
import Foundation
import HTTPTypes
import OpenAPIRuntime
@testable import SokosumiChat
import Testing

@MainActor
struct DirectStreamSessionTests {
  private let sender = Components.Schemas.ChatRoomUserParticipant(id: "me", name: "Me", email: "me@example.com", presence: .online)
  private let completedStream = """
  data: {"type":"start","messageId":"answer"}

  data: {"type":"text-start","id":"text"}

  data: {"type":"text-delta","id":"text","delta":"Answer"}

  data: {"type":"text-end","id":"text"}

  data: {"type":"finish"}

  data: [DONE]


  """

  private func room() -> Components.Schemas.ChatRoom {
    .init(id: testRoomId, name: "Coworker", kind: .direct, createdByUserId: "me", createdAt: Date(), updatedAt: Date(),
          unreadCount: 0, unreadMentionCount: 0, markedUnread: false, myAccess: .member,
          userMembers: [sender], coworkerMembers: [.init(id: "coworker", name: "Coworker", slug: "coworker", presence: .online)], sokoBotMembers: [])
  }

  @Test func idleResumeDoesNotCreateThinkingShell() async throws {
    let session = DirectStreamSession()
    session.reset(room: room())
    let client = try makeTestClient(TestTransport([(204, "")]))
    session.resume(client: client, organizationSlug: nil, settled: {
      Issue.record("Idle resume must not refresh history")
      return true
    }, failed: { Issue.record($0) })
    #expect(session.overlayMessages.isEmpty)
    await session.task?.value
    #expect(session.overlayMessages.isEmpty)
    #expect(!session.isBusy)
  }

  @Test func activeResumeShowsThinkingBeforeFirstEvent() async throws {
    let session = DirectStreamSession()
    session.reset(room: room())
    let body = HTTPBody(AsyncStream<ArraySlice<UInt8>>(unfolding: {
      await MainActor.run {
        #expect(session.phase == .streaming)
        #expect(session.overlayMessages.map(\.id) == ["stream:resume-pending"])
        #expect(session.overlayMessages.first?.content.isEmpty == true)
      }
      return nil
    }), length: .unknown, iterationBehavior: .single)
    let client = try Client.connecting(to: #require(URL(string: "https://core.example/v1")), transport: ResumeTransport(body: body))
    session.resume(client: client, organizationSlug: nil, settled: { true }, failed: { _ in })
    await session.task?.value
    // Closing without events is a truncated stream; successful reconciliation removes its shell.
    #expect(session.errorMessage != nil)
    #expect(session.overlayMessages.isEmpty)
  }

  @Test(arguments: [false, true])
  func sendsLockUntilSettlementAndRetainOverlayIfRefreshFails(refreshed: Bool) async throws {
    let session = DirectStreamSession()
    session.reset(room: room())
    let client = try makeTestClient(TestTransport([(200, completedStream)]))
    let settled: () async -> Bool = {
      #expect(session.phase == .settling)
      #expect(session.isBusy)
      #expect(session.overlayMessages.map(\.content) == ["Hello", "Answer"])
      return refreshed
    }
    #expect(session.send(" Hello ", client: client, organizationSlug: nil, settled: settled, failed: { Issue.record($0) }))
    #expect(!session.send("Again", client: client, organizationSlug: nil, settled: settled, failed: { Issue.record($0) }))
    await session.task?.value
    #expect(!session.isBusy)
    #expect(session.overlayMessages.isEmpty == refreshed)
    #expect(session.errorMessage == nil)
  }

  @Test func oldSettlementCannotClearNewRoomState() async throws {
    let session = DirectStreamSession()
    session.reset(room: room())
    let client = try makeTestClient(TestTransport([(200, completedStream)]))
    let (entered, entry) = AsyncStream<Void>.makeStream()
    let (release, gate) = AsyncStream<Void>.makeStream()
    #expect(session.send("Hello", client: client, organizationSlug: nil, settled: {
      entry.yield(())
      for await _ in release {
        break
      }
      return true
    }, failed: { Issue.record($0) }))
    let oldTask = session.task
    for await _ in entered {
      break
    }
    var other = room()
    other.id = "other"
    session.reset(room: other)
    gate.yield(())
    gate.finish()
    entry.finish()
    await oldTask?.value
    #expect(session.roomId == "other")
    #expect(session.phase == .idle)
    #expect(session.overlayMessages.isEmpty)
    #expect(session.errorMessage == nil)
  }

  @Test(arguments: [false, true])
  func truncatedStreamReconcilesHistoryAndReportsFailure(refreshed: Bool) async throws {
    let session = DirectStreamSession()
    session.reset(room: room())
    let stream = completedStream.components(separatedBy: "data: {\"type\":\"finish\"}")[0]
    let client = try makeTestClient(TestTransport([(200, stream)]))
    var failures = 0
    #expect(session.send("Hello", client: client, organizationSlug: nil, settled: {
      // Web also reconciles after a stream error; failed refresh keeps the partial answer.
      refreshed
    }, failed: { _ in failures += 1 }))
    await session.task?.value
    #expect(failures == 1)
    #expect(session.errorMessage != nil)
    #expect(session.overlayMessages.isEmpty == refreshed)
    if !refreshed {
      #expect(session.overlayMessages.last?.content == "Answer")
    }
    #expect(!session.isBusy)
  }

  @Test func onlyCoworkerOneToOneDirectsUseStream() {
    var candidate = room()
    #expect(DirectStreamSession.supports(candidate))
    candidate.sokoBotMembers = [.init(id: "bot", name: "Soko Bot", presence: .online)]
    #expect(!DirectStreamSession.supports(candidate))
    candidate.sokoBotMembers = []
    candidate.kind = .channel
    #expect(!DirectStreamSession.supports(candidate))
    candidate.kind = .direct
    candidate.userMembers.append(sender)
    #expect(!DirectStreamSession.supports(candidate))
    candidate.userMembers = [sender]
    candidate.coworkerMembers = []
    #expect(!DirectStreamSession.supports(candidate))
  }

  @Test func overlayHidesOnlyNewestRepeatedUserMessage() async throws {
    let session = DirectStreamSession()
    session.reset(room: room())
    let client = try makeTestClient(TestTransport([(200, completedStream)]))
    #expect(session.send("Hello", client: client, organizationSlug: nil,
                         settled: { false }, failed: { Issue.record($0) }))
    await session.task?.value
    var older = chatRoomMessage(from: .init(clientTurnId: "old", roomId: testRoomId, content: "Hello", sender: sender))
    older.id = "old"
    var newest = older
    newest.id = "new"
    let merged = session.displayedMessages(persisted: [older, newest])
    #expect(merged.count == 3)
    #expect(merged.first?.id == "old")
    #expect(merged.last?.content == "Answer")
    #expect(!merged.contains { $0.id == "new" })
  }

  @Test func overlayHidesNewestMatchingPersistedCoworker() async throws {
    let session = DirectStreamSession()
    session.reset(room: room())
    let client = try makeTestClient(TestTransport([(200, completedStream)]))
    #expect(session.send("Hello", client: client, organizationSlug: nil,
                         settled: { false }, failed: { Issue.record($0) }))
    await session.task?.value
    let overlay = try #require(session.overlayMessages.last)
    var older = overlay
    older.id = "old-coworker"
    var newest = overlay
    newest.id = "new-coworker"
    let merged = session.displayedMessages(persisted: [older, newest])
    #expect(merged.contains { $0.id == "old-coworker" })
    #expect(!merged.contains { $0.id == "new-coworker" })
    #expect(merged.last?.id.hasPrefix("stream:") == true)
  }

  @Test(arguments: [409, 503])
  func preStreamFailureClearsOverlayAndRestoresDraft(status: Int) async throws {
    let session = DirectStreamSession()
    session.reset(room: room())
    let error = status == 409 ? "Conflict" : "Service Unavailable"
    let message = status == 409
      ? "A coworker response is already in progress for this room."
      : "lock failed"
    let client = try makeTestClient(TestTransport([(status, """
    {"error":"\(error)","message":"\(message)","meta":{"timestamp":"\(testTimestamp)","requestId":"req","path":"/v1/chats/rooms/room/stream","method":"POST"}}
    """)]))
    var failures = 0
    #expect(session.send("Hello", client: client, organizationSlug: nil, settled: {
      Issue.record("Pre-stream failure must not settle history")
      return true
    }, failed: { _ in failures += 1 }))
    await session.task?.value
    #expect(failures == 1)
    #expect(session.overlayMessages.isEmpty)
    #expect(session.restoredDraft == "Hello")
    #expect(session.errorMessage != nil)
    #expect(!session.isBusy)
  }
}

private struct ResumeTransport: ClientTransport {
  let body: HTTPBody

  func send(_: HTTPRequest, body _: HTTPBody?, baseURL _: URL, operationID: String) async throws -> (HTTPResponse, HTTPBody?) {
    #expect(operationID == "get/chats/rooms/{id}/stream/active")
    return (HTTPResponse(status: .ok), body)
  }
}

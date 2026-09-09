import CoreAPI
import Foundation
import SokosumiChat
import Testing

@MainActor
struct RoomOutboxTests {
  private func shell(_ id: String) -> OutboundShell {
    .init(clientTurnId: id, roomId: testRoomId, content: id,
          sender: .init(id: "me", name: "Me", email: "me@example.com", presence: .online))
  }

  @Test func queuesSendsWithoutBlockingComposition() async throws {
    let outbox = RoomOutbox()
    let response = try #require(await fetchTestMessages([testMessageJSON(id: testRoomId, content: "sent", sender: testUserSender(name: "Me", email: "me@example.com"))]).first)
    var gate: CheckedContinuation<Void, Never>?
    var calls: [String] = []
    var confirmed: [String] = []
    outbox.enqueue(shell("first"), send: {
      calls.append("first")
      await withCheckedContinuation { gate = $0 }
      return response
    }, confirmed: { _ in confirmed.append("first") }, failed: { _ in Issue.record("Unexpected failure") })
    outbox.enqueue(shell("second"), send: {
      calls.append("second")
      return response
    }, confirmed: { _ in confirmed.append("second") }, failed: { _ in Issue.record("Unexpected failure") })
    while gate == nil {
      await Task.yield()
    }
    #expect(calls == ["first"])
    #expect(outbox.shells.map(\.content) == ["first", "second"])
    gate?.resume()
    while outbox.isSending {
      await Task.yield()
    }
    #expect(calls == ["first", "second"])
    #expect(confirmed == calls)
    #expect(outbox.shells.isEmpty)
  }

  @Test func failureAllowsNextSendAndRetryKeepsID() async throws {
    let outbox = RoomOutbox()
    let response = try #require(await fetchTestMessages([testMessageJSON(id: testRoomId, content: "sent", sender: testUserSender(name: "Me", email: "me@example.com"))]).first)
    var attempts = 0
    var confirmed = false
    outbox.enqueue(shell("same-id"), send: {
      attempts += 1
      if attempts == 1 {
        throw URLError(.notConnectedToInternet)
      }
      return response
    }, confirmed: { _ in confirmed = true }, failed: { _ in })
    while outbox.isSending {
      await Task.yield()
    }
    #expect(outbox.shells.first?.status == .failed)
    outbox.retry("same-id")
    #expect(outbox.shells.first?.clientTurnId == "same-id")
    while outbox.isSending {
      await Task.yield()
    }
    #expect(attempts == 2)
    #expect(confirmed)
    #expect(outbox.shells.isEmpty)
  }

  @Test func timeoutFreesQueueAndLateResultCannotOverwriteRetry() async throws {
    let outbox = RoomOutbox(timeout: .milliseconds(10))
    let response = try #require(await fetchTestMessages([testMessageJSON(id: testRoomId, content: "sent", sender: testUserSender(name: "Me", email: "me@example.com"))]).first)
    var gate: CheckedContinuation<Void, Never>?
    let failures = AsyncStream<Void>.makeStream()
    var confirmed = 0
    var attempts = 0
    var firstSendCancelled = false
    outbox.enqueue(shell("retry-id"), send: {
      attempts += 1
      if attempts == 1 {
        await withCheckedContinuation { gate = $0 }
        firstSendCancelled = Task.isCancelled
      }
      return response
    }, confirmed: { _ in confirmed += 1 }, failed: { _ in failures.continuation.yield(()) })
    var iterator = failures.stream.makeAsyncIterator()
    await iterator.next()
    #expect(!outbox.isSending)
    #expect(outbox.shells.first?.status == .failed)
    #expect(
      outbox.shells.first?.errorMessage
        == "Sending timed out. Retry to check or send this message again."
    )
    outbox.retry("retry-id")
    while outbox.isSending {
      await Task.yield()
    }
    gate?.resume()
    for _ in 0 ..< 10 {
      await Task.yield()
    }
    #expect(confirmed == 1)
    #expect(outbox.shells.isEmpty)
    #expect(!firstSendCancelled)
    failures.continuation.finish()
  }

  @Test func resetRejectsOldCompletionAndDropsQueuedSends() async throws {
    let outbox = RoomOutbox()
    let response = try #require(await fetchTestMessages([testMessageJSON(id: testRoomId, content: "sent", sender: testUserSender(name: "Me", email: "me@example.com"))]).first)
    var gate: CheckedContinuation<Void, Never>?
    var sendCancelled = false
    var sendFinished = false
    outbox.enqueue(shell("old"), send: {
      await withCheckedContinuation { gate = $0 }
      sendCancelled = Task.isCancelled
      sendFinished = true
      return response
    }, confirmed: { _ in Issue.record("Stale confirmation") }, failed: { _ in Issue.record("Stale failure") })
    outbox.enqueue(shell("queued"), send: {
      Issue.record("Queued send survived reset")
      return response
    }, confirmed: { _ in }, failed: { _ in })
    while gate == nil {
      await Task.yield()
    }
    outbox.reset()
    gate?.resume()
    for _ in 0 ..< 1000 where !sendFinished {
      await Task.yield()
    }
    #expect(sendFinished)
    #expect(!sendCancelled)
    #expect(outbox.shells.isEmpty)
    #expect(!outbox.isSending)
  }
}

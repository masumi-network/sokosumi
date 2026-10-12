import CoreAPI
import Foundation
@testable import SokosumiChat
import Testing

@MainActor
struct LoadedMessagesTests {
  /// The room shows the parent and a later message; the open Thread holds its own snapshot of the parent and one reply.
  private func loaded() async throws -> (LoadedMessages, root: Components.Schemas.ChatRoomMessage) {
    let rows = try await fetchTestMessages([
      testMessageJSON(id: "root", content: "Parent", sender: testUserSender(name: "Ada", email: "ada@example.com")),
      testMessageJSON(id: "later", content: "Later", sender: testUserSender(name: "Ada", email: "ada@example.com"))
    ])
    let root = try #require(rows.first)
    var reply = root
    reply.id = "reply"
    reply.parentMessageId = root.id
    let room = TranscriptSession()
    room.open(roomId: root.roomId)
    room.timeline.messages = rows
    let thread = ThreadSession()
    var snapshot = root
    snapshot.content = "Snapshot"
    #expect(thread.open(snapshot))
    thread.transcript.timeline.messages = [reply]
    return (LoadedMessages(room: room, thread: thread), root)
  }

  @Test func everyCopyIsFoundRoomFirst() async throws {
    let (loaded, root) = try await loaded()
    #expect(loaded.all.map(\.id) == ["root", "later", "root", "reply"])
    #expect(loaded.message("reply")?.parentMessageId == root.id)
    #expect(loaded.message("missing") == nil)
  }

  /// One change reaches the room's copy and the Thread's parent, each transformed on its own; nothing else moves.
  @Test func anUpdateReachesEachCopyOfThatMessageOnly() async throws {
    let (loaded, root) = try await loaded()
    loaded.update(root.id) { message in
      var edited = message
      edited.content += " (edited)"
      return edited
    }
    #expect(loaded.room.timeline.messages.map(\.content) == ["Parent (edited)", "Later"])
    // The Thread's parent is transformed from its own snapshot, not replaced by the room's copy.
    #expect(loaded.thread.parent?.content == "Snapshot (edited)")
    #expect(loaded.thread.transcript.timeline.messages.map(\.content) == ["Parent"])

    loaded.update("reply") { message in
      var edited = message
      edited.content = "Reply (edited)"
      return edited
    }
    #expect(loaded.thread.transcript.timeline.messages.map(\.content) == ["Reply (edited)"])
    loaded.update("missing") { _ in Issue.record("A message that is not loaded is never transformed")
      return root
    }
  }

  /// A confirmed delete of the parent tombstones the room's row and the Thread's parent.
  @Test func aConfirmedChangeReachesTheRoomAndTheThread() async throws {
    let (loaded, root) = try await loaded()
    var deleted = root
    deleted.deletedAt = Date(timeIntervalSince1970: 1_800_000_000)
    loaded.apply(eventType: .delete, message: deleted)
    #expect(loaded.room.timeline.messages.first { $0.id == root.id }?.deletedAt != nil)
    #expect(loaded.thread.parent?.deletedAt != nil)
  }
}

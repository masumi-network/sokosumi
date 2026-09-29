import CoreAPI
import Foundation
@testable import SokosumiChat
import Testing

struct PreparedTranscriptTests {
  @Test func editsAndRemovalsPublishMatchingDocuments() async throws {
    let first = try await PreparedTranscript.prepare(input([message("one", "**Original**"), message("two", "Removed")]), reusing: nil)
    let next = try await PreparedTranscript.prepare(input([message("one", "**Edited**")]), reusing: first)
    #expect(first.input.messages.first?.content == "**Original**")
    #expect(try String(#require(first.documents["one"]?.blocks.first).text.characters) == "Original")
    #expect(next.input.messages.first?.content == "**Edited**")
    #expect(try String(#require(next.documents["one"]?.blocks.first).text.characters) == "Edited")
    #expect(next.documents["two"] == nil)
  }

  @Test func resolvingContextIsNotReusedAcrossOrigins() async throws {
    let messages = [message("one", "[Room](/chat)")]
    let first = try await PreparedTranscript.prepare(input(messages), reusing: nil)
    let nextInput = try PreparedTranscript.Input(scope: ["room"], messages: messages, mentions: nil, channels: [], baseURL: #require(URL(string: "https://other.example")))
    let next = try await PreparedTranscript.prepare(nextInput, reusing: first)
    let text = try #require(next.documents["one"]?.blocks.first?.text)
    #expect(text.runs.compactMap(\.link).map(\.absoluteString) == ["https://other.example/chat"])
  }

  @Test func overlayingDropsSnapshotRowsMissingFromLiveAndPrefersLivePayload() {
    let prepared = PreparedTranscript(
      input: input([message("keep", "Old"), message("gone", "Delete me")]),
      documents: [:]
    )
    let live = [message("keep", "New")]
    #expect(prepared.overlaying(live).map(\.id) == ["keep"])
    #expect(prepared.overlaying(live).first?.content == "New")
  }

  @Test func cancelledPreparationCannotPublish() async {
    let task = Task {
      withUnsafeCurrentTask { $0?.cancel() }
      return try await PreparedTranscript.prepare(input([message("one", "Content")]), reusing: nil)
    }
    do {
      _ = try await task.value
      Issue.record("Cancelled preparation returned a publishable snapshot")
    } catch {
      #expect(error is CancellationError)
    }
  }

  private func input(_ messages: [Components.Schemas.ChatRoomMessage]) -> PreparedTranscript.Input {
    .init(scope: ["room"], messages: messages, mentions: nil, channels: [], baseURL: URL(string: "https://example.com")!)
  }

  private func message(_ id: String, _ content: String) -> Components.Schemas.ChatRoomMessage {
    var message = chatRoomMessage(from: .init(clientTurnId: id, roomId: "room", content: content,
                                              sender: .init(id: "human", name: "Human", email: "human@example.com", presence: .online)))
    message.id = id
    return message
  }
}

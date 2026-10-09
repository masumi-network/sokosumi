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

  /// Row 10d: transcript bodies (rooms, Directs, Threads) draw `mermaid` fences, as web's `ChannelMessageText` does.
  @Test func transcriptBodiesDrawMermaidFences() async throws {
    let prepared = try await PreparedTranscript.prepare(input([message("one", "```mermaid\nflowchart TD\nA --> B\n```")]), reusing: nil)
    let block = try #require(prepared.documents["one"]?.blocks.first)
    #expect(block.diagram == MermaidDiagram(source: "flowchart TD\nA --> B", complete: true, overLimit: false))
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

  /// Core's reply swaps `pending:{turn}` for the server id before re-prepare lands; the row must not blink out.
  @Test func overlayingKeepsSendWhenConfirmedRowReplacesPendingShell() async throws {
    let shell = chatRoomMessage(from: .init(clientTurnId: "turn", roomId: "room", content: "**Sent**", createdAt: Date(),
                                            sender: .init(id: "human", name: "Human", email: "human@example.com", presence: .online)))
    let prepared = try await PreparedTranscript.prepare(input([message("keep", "Old"), shell]), reusing: nil)
    var confirmed = shell
    confirmed.id = "server-id"
    let rows = prepared.overlaying([message("keep", "Old"), confirmed])
    #expect(rows.map(\.id) == ["keep", "server-id"])
    #expect(try String(#require(prepared.document(for: confirmed)?.blocks.first).text.characters) == "Sent")
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
                                              createdAt: Date(),
                                              sender: .init(id: "human", name: "Human", email: "human@example.com", presence: .online)))
    message.id = id
    return message
  }
}

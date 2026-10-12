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

  /// A waiting older page hides its prefix alone: existing streams and new arrivals stay live.
  @Test func overlayingKeepsLiveSuffixWhileOlderRowsWait() async throws {
    let prepared = try await PreparedTranscript.prepare(input([message("keep", "Original"), message("last", "Last")]), reusing: nil)
    let live = [message("older", "Older"), message("keep", "Streamed"), message("last", "Last"), message("arrival", "New arrival")]
    let rows = prepared.overlaying(live)
    #expect(rows.map(\.id) == ["keep", "last", "arrival"])
    #expect(rows.first?.content == "Streamed")
    #expect(try prepared.document(for: #require(rows.first)) == nil)
    #expect(try prepared.document(for: #require(rows.last)) == nil)
    let landed = try await PreparedTranscript.prepare(input(live), reusing: prepared)
    #expect(landed.overlaying(live).map(\.id) == ["older", "keep", "last", "arrival"])
    #expect(try String(#require(landed.document(for: live[1])?.blocks.first).text.characters) == "Streamed")
  }

  @Test func overlayingUsesFirstSurvivingRowAfterDeletion() {
    let prepared = PreparedTranscript(input: input([message("gone", "Deleted"), message("keep", "Original")]), documents: [:])
    let live = [message("older", "Older"), message("keep", "Edited"), message("arrival", "New arrival")]
    #expect(prepared.overlaying(live).map(\.id) == ["keep", "arrival"])
    #expect(prepared.overlaying([message("older", "Older")]).isEmpty)
    #expect(PreparedTranscript(input: input([]), documents: [:]).overlaying(live).isEmpty)
  }

  @Test func deletedOldestRowStillHoldsTheOlderPrefix() {
    let current = PreparedTranscript(input: input([message("gone", "Deleted"), message("keep", "Retained")]), documents: [:])
    let live = [message("older", "Older"), message("keep", "Retained"), message("arrival", "New arrival")]
    let next = PreparedTranscript(input: input(live), documents: [:])
    #expect(current.lacksRowsAbove(in: live))
    #expect(next.prependsRows(to: current))
    #expect(!current.lacksRowsAbove(in: [message("arrival", "No surviving row")]))
  }

  @Test func preparedDocumentsMatchCurrentSource() async throws {
    let original = message("one", "**Original**")
    let prepared = try await PreparedTranscript.prepare(input([original]), reusing: nil)
    #expect(prepared.document(for: original) != nil)
    #expect(prepared.document(for: message("one", "**Edited**")) == nil)
  }

  @Test func confirmedOldestShellKeepsArrivalsAndRejectsChangedDocument() async throws {
    let shell = chatRoomMessage(from: .init(clientTurnId: "turn", roomId: "room", content: "**Sent**", createdAt: Date(),
                                            sender: .init(id: "human", name: "Human", email: "human@example.com", presence: .online)))
    let prepared = try await PreparedTranscript.prepare(input([shell]), reusing: nil)
    var confirmed = shell
    confirmed.id = "server-id"
    let live = [message("older", "Older"), confirmed, message("arrival", "New arrival")]
    #expect(prepared.overlaying(live).map(\.id) == ["server-id", "arrival"])
    #expect(prepared.lacksRowsAbove(in: live))
    #expect(prepared.document(for: confirmed) != nil)
    confirmed.content = "Edited after sending"
    #expect(prepared.document(for: confirmed) == nil)
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

  /// M6: an older page lands above the first row the room shows; a live row, an edit or a deletion does not.
  @Test func onlyRowsAboveTheFirstRowArePrepended() throws {
    func snapshot(_ ids: [String], scope: [String] = ["room"]) throws -> PreparedTranscript {
      try PreparedTranscript(input: .init(scope: scope, messages: ids.map { message($0, $0) }, mentions: nil, channels: [],
                                          baseURL: #require(URL(string: "https://example.com"))), documents: [:])
    }
    let current = try snapshot(["b", "c"])
    #expect(try snapshot(["a", "b", "c"]).prependsRows(to: current))
    #expect(try snapshot(["a", "b", "c", "d"]).prependsRows(to: current))
    #expect(try !snapshot(["b", "c", "d"]).prependsRows(to: current))
    #expect(try !snapshot(["b", "c"]).prependsRows(to: current))
    #expect(try !snapshot(["c"]).prependsRows(to: current))
    #expect(try !snapshot(["a", "b", "c"]).prependsRows(to: nil))
    #expect(try !snapshot(["a", "b", "c"], scope: ["other room"]).prependsRows(to: current))
    // The live rows before a snapshot is prepared from them: an older page in flight.
    #expect(current.lacksRowsAbove(in: ["a", "b", "c"].map { message($0, $0) }))
    #expect(!current.lacksRowsAbove(in: ["b", "c", "d"].map { message($0, $0) }))
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

#if os(macOS)
  import AppKit
  import CoreAPI
  import OpenAPIRuntime
  @testable import Sokosumi
  import SokosumiAuth
  import SokosumiChat
  import SokosumiWorkspace
  import SwiftUI
  import Testing

  /// Soko Bot rows in the transcript: the settled reply's footer (approvals,
  /// rating, Tasks) and the assistant-to-assistant hop badge.
  @MainActor struct SokoBotMessageRowTests {
    private func botMessage(id: String, content: String, metadata: [String: any Sendable]) throws -> Components.Schemas.ChatRoomMessage {
      try .init(
        id: id,
        roomId: "room",
        parentMessageId: nil,
        content: content,
        createdAt: Date(timeIntervalSince1970: 1_788_868_800),
        deletedAt: nil,
        editedAt: nil,
        sender: .case3(.init(_type: .sokoBot, sokoBot: .init(id: "bot_1", name: "Soko", caption: "Ada's personal assistant", image: nil, avatarSeed: "orb:user_2", presence: .online))),
        mentions: [],
        reactions: [],
        threadReplyCount: 0,
        threadLastReplyAt: nil,
        metadata: .init(additionalProperties: metadata.mapValues { try OpenAPIValueContainer(unvalidatedValue: $0) }),
        quote: nil,
        membership: nil,
        unfurls: nil
      )
    }

    @Test func turnAndChainMetadataAreReadFromTheGeneratedDTO() throws {
      let settled = try botMessage(id: "settled", content: "Done.", metadata: [
        "mention_id": "mention_1",
        "soko_bot": ["turn_id": "turn_1", "pending_decision_ids": ["dec_1"] as [String], "task_ids": ["task_1", "task_2"] as [String]] as [String: any Sendable]
      ])
      #expect(SokoBotTurnMetadata(message: settled) == .init(turnId: "turn_1", pendingDecisionIds: ["dec_1"], taskIds: ["task_1", "task_2"]))
      #expect(SokoBotChainMetadata(message: settled) == nil)
      let hop = try botMessage(id: "hop", content: "Noted, passing it on.", metadata: [
        "soko_bot_chain": ["depth": 2, "max_depth": 3, "room_messages_this_hour": 4, "room_messages_per_hour": 20] as [String: Int]
      ])
      #expect(SokoBotChainMetadata(message: hop) == .init(depth: 2, maxDepth: 3, roomMessagesThisHour: 4, roomMessagesPerHour: 20))
      #expect(SokoBotTurnMetadata(message: hop) == nil)
      // A shell without its answer never reaches the row (web drops it from the transcript).
      let shell = try botMessage(id: "shell", content: "", metadata: ["streaming": true, "mention_id": "mention_1", "soko_bot": ["turn_id": "turn_1"] as [String: String]])
      #expect(!shouldKeepPersistedMessage(shell))
      #expect(displayedTranscript(messages: [shell, settled], shells: []).map(\.id) == ["settled"])
    }

    @Test(arguments: [false, true])
    func footerAndChainBadgeFitTheTranscript(dark: Bool) async throws {
      let waiting = try botMessage(id: "waiting", content: "I drafted the release note and asked Elena to review the numbers. Two steps need your go-ahead before I send anything.", metadata: [
        "mention_id": "mention_1",
        "soko_bot": ["turn_id": "turn_1", "pending_decision_ids": ["dec_1", "dec_2"] as [String], "task_ids": ["task_1"] as [String]] as [String: any Sendable]
      ])
      let rated = try botMessage(id: "rated", content: "Your Tuesday is clear after 3 pm; I moved the two reviews to Wednesday morning.", metadata: [
        "soko_bot": ["turn_id": "turn_2", "source": "SCHEDULE"] as [String: String]
      ])
      let hop = try botMessage(id: "hop", content: "Passing this on to Bob's assistant.", metadata: [
        "soko_bot_chain": ["depth": 3, "max_depth": 3, "room_messages_this_hour": 7, "room_messages_per_hour": 20] as [String: Int]
      ])
      let chain = try #require(SokoBotChainMetadata(message: hop))
      let ratedTurn = try #require(SokoBotTurnMetadata(message: rated))
      let content = VStack(alignment: .leading, spacing: 12) {
        MessageRowView(message: waiting, isContinuation: false, outbound: nil, onRetry: nil, onRemove: nil)
        SokoBotMessageFooterContent(turn: ratedTurn, feedback: true)
          .padding(.leading, 42)
        MessageRowView(message: hop, isContinuation: false, outbound: nil, onRetry: nil, onRemove: nil, onQuote: {})
        HStack(spacing: 8) {
          SokoBotChainBadge(chain: chain)
          Text(chain.summary).font(.caption).foregroundStyle(.secondary)
        }
        .padding(.leading, 42)
      }
      .padding(20)
      .frame(width: 520, alignment: .leading)
      .background(.background)
      .environmentObject(WorkspaceState()).environmentObject(AuthState())
      .environment(\.colorScheme, dark ? .dark : .light)
      let host = NSHostingView(rootView: content)
      host.frame = NSRect(x: 0, y: 0, width: 520, height: 460)
      for _ in 0 ..< 10 {
        host.layoutSubtreeIfNeeded()
        try await Task.sleep(for: .milliseconds(20))
      }
      #expect(host.fittingSize.height < 460)
      let bitmap = try #require(host.bitmapImageRepForCachingDisplay(in: host.bounds))
      host.cacheDisplay(in: host.bounds, to: bitmap)
      let png = try #require(bitmap.representation(using: .png, properties: [:]))
      try png.write(to: URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("soko-bot-footer-\(dark ? "dark" : "light").png"))
    }
  }
#endif

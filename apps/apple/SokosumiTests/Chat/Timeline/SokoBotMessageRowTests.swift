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

  /// Soko Bot rows in the transcript: the settled reply's footer (approvals and
  /// Tasks; the rating is in the hover toolbar, row 38b) and the assistant-to-assistant hop badge.
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
        sender: .case3(.init(_type: .sokoBot, sokoBot: .init(id: "bot_1", name: "Soko", caption: "Ada's personal assistant", image: nil, avatarSeed: "orb:user_2", ownerUserId: "user_2", scope: .personal, presence: .online))),
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

    @Test(arguments: [DirectRecipient.sokoBot("bot"), .coworker("coworker"), .human("person")])
    func senderHeaderIdentifiesAgentsEvenWithoutTurnMetadata(_ recipient: DirectRecipient) async throws {
      var message = try botMessage(id: "sender", content: "Here is the brief.", metadata: [:])
      let isAgent: Bool
      switch recipient {
      case .sokoBot: isAgent = true
      case let .coworker(id):
        isAgent = true
        message.sender = .case2(.init(_type: .coworker, coworker: .init(id: id, name: "Soko", slug: "soko", caption: nil, image: nil, presence: .online)))
      case let .human(id):
        isAgent = false
        message.sender = .case1(.init(_type: .user, user: .init(id: id, name: "Soko", email: "person@example.org", image: nil, presence: .online)))
      }
      let host = NSHostingView(rootView: MessageRowView(message: message, row: transcriptRow(message), outbound: nil)
        .environmentObject(WorkspaceState()).environmentObject(AuthState()).environment(\.locale, Locale(identifier: "en")))
      let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 480, height: 120), styleMask: [.titled], backing: .buffered, defer: false)
      window.contentView = host
      defer { window.orderOut(nil) }
      window.orderFront(nil)
      host.layoutSubtreeIfNeeded()
      let labels = await hostedTexts(in: host)
      #expect(labels.contains("Soko (AI agent)") == isAgent)
      if !isAgent {
        #expect(labels.contains("Soko"))
      }
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
      // A shell without its answer stays in the transcript and draws its live Thinking (web #5617, row 38d).
      let shell = try botMessage(id: "shell", content: "", metadata: ["streaming": true, "mention_id": "mention_1", "soko_bot": ["turn_id": "turn_1"] as [String: String]])
      #expect(shouldKeepPersistedMessage(shell))
      #expect(displayedTranscript(messages: [shell, settled], shells: []).map(\.id) == ["shell", "settled"])
    }

    @Test(arguments: [false, true])
    func footerAndChainBadgeFitTheTranscript(dark: Bool) async throws {
      let waiting = try botMessage(id: "waiting", content: "I drafted the release note and asked Elena to review the numbers. Two steps need your go-ahead before I send anything.", metadata: [
        "mention_id": "mention_1",
        "soko_bot": ["turn_id": "turn_1", "pending_decision_ids": ["dec_1", "dec_2"] as [String], "task_ids": ["task_1"] as [String]] as [String: any Sendable]
      ])
      let hop = try botMessage(id: "hop", content: "Passing this on to Bob's assistant.", metadata: [
        "soko_bot_chain": ["depth": 3, "max_depth": 3, "room_messages_this_hour": 7, "room_messages_per_hour": 20] as [String: Int]
      ])
      let chain = try #require(SokoBotChainMetadata(message: hop))
      let content = VStack(alignment: .leading, spacing: 12) {
        MessageRowView(message: waiting, row: transcriptRow(waiting), outbound: nil)
        MessageRowView(message: hop, row: transcriptRow(hop), outbound: nil, perform: { _ in nil })
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
    }
  }
#endif

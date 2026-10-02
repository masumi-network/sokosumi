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

  extension NativeWindowTests {
    /// Row 38a: web's message row resolves the coworker Thought view for a Soko Bot sender too (#5304). The
    /// settled reply shows the collapsed "Thought for Ns" disclosure over its capability beats; the mention
    /// placeholder, drawn on its own, the live Thinking trace; a failed turn "Failed to reply". The transcript
    /// still drops both bodiless shells, as web's does (`SokoBotMessageMetadataTests`).
    @MainActor struct SokoBotThoughtViewTests {
      private static let beats = ["Finding Coworkers", "Creating a Task", "Assigning a Task"]

      private static let sokoBot = Components.Schemas.ChatRoomMessageSender.case3(.init(_type: .sokoBot, sokoBot: .init(
        id: "bot_1", name: "Soko", caption: "Ada's personal assistant", image: nil, avatarSeed: "orb:user_2", ownerUserId: "user_2", presence: .online
      )))
      private static let coworker = Components.Schemas.ChatRoomMessageSender.case2(.init(_type: .coworker, coworker: .init(
        id: "cow_1", name: "Soko", slug: "soko", caption: nil, image: nil, presence: .online
      )))

      private static func bot(_ id: String, content: String, metadata: [String: any Sendable],
                              sender: Components.Schemas.ChatRoomMessageSender = sokoBot) throws -> Components.Schemas.ChatRoomMessage {
        try .init(
          id: id,
          roomId: "room",
          parentMessageId: nil,
          content: content,
          createdAt: Date(timeIntervalSince1970: 1_788_868_800),
          deletedAt: nil,
          editedAt: nil,
          sender: sender,
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

      private static var reasoning: [[String: String]] {
        beats.map { ["type": "reasoning", "text": $0] }
      }

      /// Core's placeholder while the turn runs (`publishSokoBotChatProgress`); its clock started twelve seconds ago.
      private static func placeholder(sender: Components.Schemas.ChatRoomMessageSender = sokoBot) throws -> Components.Schemas.ChatRoomMessage {
        let start = Int((Date().timeIntervalSince1970 - 12) * 1000)
        return try bot("placeholder", content: "", metadata: [
          "in_reply_to_message_id": "source", "mention_id": "mention_1", "streaming": true, "reasoning": Array(reasoning.prefix(2)),
          "thought_timing_ms": ["start": start], "soko_bot": ["turn_id": "turn_1"]
        ], sender: sender)
      }

      /// Core's settled answer (`persistSokoBotChatTurn`): the beats, a 14 s turn, the footer's turn record.
      private static func settled(reasoning: Bool = true,
                                  sender: Components.Schemas.ChatRoomMessageSender = sokoBot) throws -> Components.Schemas.ChatRoomMessage {
        var metadata: [String: any Sendable] = [
          "in_reply_to_message_id": "source", "mention_id": "mention_2",
          "soko_bot": ["turn_id": "turn_2", "pending_decision_ids": [String](), "task_ids": ["task_1"]] as [String: any Sendable]
        ]
        if reasoning {
          metadata["reasoning"] = Self.reasoning
          metadata["thought_timing_ms"] = ["start": 1_788_868_800_000, "end": 1_788_868_814_000]
        }
        return try bot("settled", content: "I created the Task and assigned it to Elena.", metadata: metadata, sender: sender)
      }

      private static func failed(sender: Components.Schemas.ChatRoomMessageSender = sokoBot) throws -> Components.Schemas.ChatRoomMessage {
        try bot("failed", content: "", metadata: [
          "in_reply_to_message_id": "source", "mention_id": "mention_3", "mention_failed": true, "soko_bot": ["turn_id": "turn_3"]
        ], sender: sender)
      }

      private static func row(_ message: Components.Schemas.ChatRoomMessage, retry: Bool = false) -> MessageRowView {
        MessageRowView(message: message, isContinuation: false, outbound: nil, onRetry: nil, onRemove: nil,
                       onRetryMention: retry ? {} : nil, horizontalInset: 12)
      }

      private static func host(_ content: some View, dark: Bool) -> NSHostingView<AnyView> {
        NSHostingView(rootView: AnyView(content
            .frame(width: 520, alignment: .leading)
            .background(.background)
            .environmentObject(WorkspaceState()).environmentObject(AuthState())
            .environment(\.colorScheme, dark ? .dark : .light)))
      }

      private static func height(_ message: Components.Schemas.ChatRoomMessage) async throws -> CGFloat {
        let host = host(row(message), dark: false)
        for _ in 0 ..< 5 {
          host.layoutSubtreeIfNeeded()
          try await Task.sleep(for: .milliseconds(20))
        }
        return host.fittingSize.height
      }

      /// Heights run on CI, where Vision does not. Each Soko Bot row lays out exactly as the same row from a
      /// coworker (web draws both through one Thought view), and the settled disclosure adds a line.
      @Test func sokoBotRowsDrawTheCoworkerThoughtView() async throws {
        let withThought = try await Self.height(Self.settled())
        let withoutThought = try await Self.height(Self.settled(reasoning: false))
        #expect(withThought > withoutThought, "The settled reply shows its Thought disclosure: \(withoutThought) → \(withThought)")
        #expect(try await withThought == Self.height(Self.settled(sender: Self.coworker)), "Settled reply")
        let placeholder = try await Self.height(Self.placeholder())
        #expect(try await placeholder == Self.height(Self.placeholder(sender: Self.coworker)), "Placeholder: Thinking and its beats")
        let failed = try await Self.height(Self.failed())
        #expect(try await failed == Self.height(Self.failed(sender: Self.coworker)), "Failed turn: Failed to reply")
      }

      @Test(arguments: [false, true])
      func rendersTheSokoBotThought(dark: Bool) async throws {
        let placeholder = try Self.placeholder()
        let settled = try Self.settled()
        let failed = try Self.failed()
        let content = VStack(alignment: .leading, spacing: 12) {
          Self.row(placeholder)
          Self.row(settled)
          Self.row(failed, retry: true)
        }
        .padding(.vertical, 12)
        let host = Self.host(content, dark: dark)
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 520, height: 400), styleMask: [.titled], backing: .buffered, defer: false)
        window.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        window.contentView = host
        window.orderFront(nil)
        defer { window.orderOut(nil) }
        for _ in 0 ..< 10 {
          host.layoutSubtreeIfNeeded()
          try await Task.sleep(for: .milliseconds(20))
        }
        let bitmap = try fittedBitmap(of: host, in: window)
        try Attachment.record(#require(bitmap.representation(using: .png, properties: [:])), named: "soko-bot-thought-\(dark ? "dark" : "light").png")
        let corner = try #require(bitmap.colorAt(x: 2, y: bitmap.pixelsHigh - 2)?.usingColorSpace(.deviceRGB))
        #expect(corner.alphaComponent == 1, "Hosted over the window background: alpha \(corner.alphaComponent)")
        #expect(dark ? corner.brightnessComponent < 0.5 : corner.brightnessComponent > 0.5)
        // Vision reads text only on a local run (the CI runner returns nil); the height test carries the rest.
        guard let lines = try RoomThreadOverviewGroupsViewTests.recognizedText(in: bitmap) else { return }
        let texts = lines.map(\.text)
        for expected in ["Thinking", "Finding Coworkers", "Creating a Task", "Thought for 14s", "I created the Task", "Failed to reply"] {
          #expect(texts.contains { $0.contains(expected) }, "\(expected) in \(texts)")
        }
        #expect(!texts.contains { $0.contains("Assigning a Task") }, "The settled disclosure stays collapsed: \(texts)")
      }
    }
  }
#endif

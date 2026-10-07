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
    /// Row 38d: since web #5617 (`isMentionThoughtShell`) the transcript keeps a Soko Bot's bodiless mention
    /// shell as it keeps a coworker's, so the live Thinking (clock and tool-step beats) and "Failed to reply"
    /// with the mentioner's Retry show in the room. The rows themselves are 38a's and 37's, unchanged.
    @MainActor struct SokoBotShellTranscriptTests {
      private static let reader = Components.Schemas.ChatRoomUserParticipant(id: "user_1", name: "Ada Lovelace", email: "ada@example.com", presence: .online)
      private static let sokoBot = Components.Schemas.ChatRoomMessageSender.case3(.init(_type: .sokoBot, sokoBot: .init(
        id: "bot_1", name: "Soko", caption: "Ada's personal assistant", image: nil, avatarSeed: "orb:user_1", ownerUserId: "user_1", presence: .online
      )))

      private static func message(_ id: String, content: String, sender: Components.Schemas.ChatRoomMessageSender,
                                  seconds: TimeInterval, metadata: [String: any Sendable]?) throws -> Components.Schemas.ChatRoomMessage {
        try .init(
          id: id,
          roomId: "room",
          parentMessageId: nil,
          content: content,
          createdAt: Date(timeIntervalSince1970: 1_788_868_800 + seconds),
          deletedAt: nil,
          editedAt: nil,
          sender: sender,
          mentions: [],
          reactions: [],
          threadReplyCount: 0,
          threadLastReplyAt: nil,
          metadata: metadata.map { try .init(additionalProperties: $0.mapValues { try OpenAPIValueContainer(unvalidatedValue: $0) }) },
          quote: nil,
          membership: nil,
          unfurls: nil
        )
      }

      /// The room as Core leaves it: Ada's two requests, the placeholder of the turn still running (Core's
      /// `publishSokoBotChatProgress`, clock started nine seconds ago) and the failed turn (`persistSokoBotChatTurn`).
      private static func persisted() throws -> [Components.Schemas.ChatRoomMessage] {
        let ada = Components.Schemas.ChatRoomMessageSender.case1(.init(_type: .user, user: reader))
        let start = Int((Date().timeIntervalSince1970 - 9) * 1000)
        return try [
          message("source_1", content: "@Soko what's on tomorrow?", sender: ada, seconds: 0, metadata: nil),
          message("failed", content: "", sender: sokoBot, seconds: 1, metadata: [
            "in_reply_to_message_id": "source_1", "mention_id": "mention_1", "mention_failed": true, "soko_bot": ["turn_id": "turn_1"]
          ]),
          message("source_2", content: "@Soko create a Task for Elena to review the draft", sender: ada, seconds: 60, metadata: nil),
          message("placeholder", content: "", sender: sokoBot, seconds: 61, metadata: [
            "in_reply_to_message_id": "source_2", "mention_id": "mention_2", "streaming": true,
            "reasoning": [["type": "reasoning", "text": "Finding Coworkers"], ["type": "reasoning", "text": "Creating a Task"]],
            "thought_timing_ms": ["start": start], "soko_bot": ["turn_id": "turn_2"]
          ])
        ]
      }

      /// Runs on CI, where Vision does not: both shells reach the transcript the room view lists.
      @Test func theRoomListsBothSokoBotShells() throws {
        #expect(try displayedTranscript(messages: Self.persisted(), shells: []).map(\.id) == ["source_1", "failed", "source_2", "placeholder"])
      }

      @Test(arguments: [false, true])
      func rendersTheShellsInTheTranscript(dark: Bool) async throws {
        let rows = try displayedTranscript(messages: Self.persisted(), shells: [])
        let content = VStack(alignment: .leading, spacing: 12) {
          ForEach(rows, id: \.id) { row in
            MessageRowView(message: row, isContinuation: false, outbound: nil, onRetry: nil, onRemove: nil,
                           onRetryMention: row.id == "failed" ? {} : nil, horizontalInset: 12)
          }
        }
        .padding(.vertical, 12)
        let host = NSHostingView(rootView: AnyView(content
            .frame(width: 520, alignment: .leading)
            .background(.background)
            .environmentObject(WorkspaceState()).environmentObject(AuthState())
            .environment(\.colorScheme, dark ? .dark : .light)))
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
        try Attachment.record(#require(bitmap.representation(using: .png, properties: [:])), named: "soko-bot-shells-\(dark ? "dark" : "light").png")
        let corner = try #require(bitmap.colorAt(x: 2, y: bitmap.pixelsHigh - 2)?.usingColorSpace(.deviceRGB))
        #expect(corner.alphaComponent == 1, "Hosted over the window background: alpha \(corner.alphaComponent)")
        #expect(dark ? corner.brightnessComponent < 0.5 : corner.brightnessComponent > 0.5)
        // Vision reads text only on a local run (the CI runner returns nil); the transcript test carries the rest.
        guard let lines = try RoomThreadOverviewGroupsViewTests.recognizedText(in: bitmap) else { return }
        let texts = lines.map(\.text)
        for expected in ["what's on tomorrow", "Failed to reply", "Retry", "create a Task", "Thinking", "Finding Coworkers", "Creating a Task"] {
          #expect(texts.contains { $0.contains(expected) }, "\(expected) in \(texts)")
        }
      }
    }
  }
#endif

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
    /// Row 09c: a coworker thinking live shows the whole reasoning trace in the real message row, as web's
    /// `CoworkerLiveThought` does — one line per beat from the start of the trace, three lines at most, the
    /// third ending in an ellipsis — and the Thought disclosure once the answer streams.
    @MainActor struct CoworkerLiveThoughtViewTests {
      private static let short = ["Reading the thread", "Comparing the drafts", "Weighing the options", "Drafting the reply"]
      private static let long = [
        "Reading the last three release notes and the thread that asked for this summary",
        "Comparing the registration counts for the last 30 days against the previous period, one row per organization",
        "Checking which of the new organizations came through the partner program",
        "Drafting the reply"
      ]

      /// A stream overlay row as `DirectStreamSession` builds it: `stream:` id, the coworker, the beats in
      /// `metadata.reasoning`. Its clock starts twelve seconds before the real one.
      private static func overlay(_ id: String, beats: [String], answer: String = "") throws -> Components.Schemas.ChatRoomMessage {
        let reasoning = beats.map { ["type": "reasoning", "text": $0] }
        return try .init(
          id: "stream:\(id)",
          roomId: "room",
          parentMessageId: nil,
          content: answer,
          createdAt: Date().addingTimeInterval(-12),
          deletedAt: nil,
          editedAt: nil,
          sender: .case2(.init(_type: .coworker, coworker: .init(id: "cow_1", name: "Elena", slug: "elena", caption: nil, image: nil, presence: .online))),
          mentions: [],
          reactions: [],
          threadReplyCount: 0,
          threadLastReplyAt: nil,
          metadata: .init(additionalProperties: ["reasoning": OpenAPIValueContainer(unvalidatedValue: reasoning)]),
          quote: nil,
          membership: nil,
          unfurls: nil
        )
      }

      private static func row(_ message: Components.Schemas.ChatRoomMessage, thinking: Bool) -> some View {
        MessageRowView(message: message, isContinuation: false, outbound: nil, onRetry: nil, onRemove: nil,
                       horizontalInset: 12, streamThinking: thinking)
      }

      private static func host(_ content: some View, dark: Bool) -> NSHostingView<AnyView> {
        NSHostingView(rootView: AnyView(content
            .frame(width: 520, alignment: .leading)
            .background(.background)
            .environmentObject(WorkspaceState()).environmentObject(AuthState())
            .environment(\.colorScheme, dark ? .dark : .light)))
      }

      /// Height of one thinking row with `beats`, after its layout settles.
      private static func height(beats: [String]) async throws -> CGFloat {
        let host = try host(row(overlay("answer", beats: beats), thinking: true), dark: false)
        for _ in 0 ..< 5 {
          host.layoutSubtreeIfNeeded()
          try await Task.sleep(for: .milliseconds(20))
        }
        return host.fittingSize.height
      }

      /// Web stacks the beats without a blank line between them and clamps the stack to three lines: two
      /// short beats take two lines, three take three, a fourth adds nothing.
      @Test func everyBeatTakesALineUpToThree() async throws {
        let two = try await Self.height(beats: Array(Self.short.prefix(2)))
        let three = try await Self.height(beats: Array(Self.short.prefix(3)))
        let four = try await Self.height(beats: Self.short)
        #expect(three > two, "A third beat adds a line: \(two) → \(three)")
        #expect(four == three, "The trace clamps at three lines: \(three) → \(four)")
      }

      /// Three short beats, a long trace clamped from its start, and the disclosure after the answer.
      @Test(arguments: [false, true])
      func rendersTheWholeTraceWhileThinking(dark: Bool) async throws {
        let short = try Self.overlay("short", beats: Array(Self.short.prefix(3)))
        let long = try Self.overlay("long", beats: Self.long)
        let answered = try Self.overlay("answered", beats: Self.long, answer: "Registrations rose 12 % against the previous 30 days.")
        let content = VStack(alignment: .leading, spacing: 12) {
          Self.row(short, thinking: true)
          Self.row(long, thinking: true)
          Self.row(answered, thinking: false)
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
        try Attachment.record(#require(bitmap.representation(using: .png, properties: [:])), named: "coworker-live-thought-\(dark ? "dark" : "light").png")
        let corner = try #require(bitmap.colorAt(x: 2, y: bitmap.pixelsHigh - 2)?.usingColorSpace(.deviceRGB))
        #expect(corner.alphaComponent == 1, "Hosted over the window background: alpha \(corner.alphaComponent)")
        #expect(dark ? corner.brightnessComponent < 0.5 : corner.brightnessComponent > 0.5)
        // Vision reads text only on a local run (the CI runner returns nil); the height test carries the rest.
        guard let lines = try RoomThreadOverviewGroupsViewTests.recognizedText(in: bitmap) else { return }
        // Vision reads the short lines reliably, the long ones not; the long rows are inspected in the render.
        let texts = lines.map(\.text)
        for beat in ["Reading the thread", "Comparing the", "Weighing the options"] {
          #expect(texts.contains { $0.contains(beat) }, "Every beat shows on its own line: \(beat) in \(texts)")
        }
        #expect(!texts.contains { $0.contains("partner program") }, "The long trace clamps before its third beat: \(texts)")
      }
    }
  }
#endif

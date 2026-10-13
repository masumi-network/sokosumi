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

  /// Persisted mention shells in the transcript: live Thought (with and without
  /// reasoning beats) and the failed shell with the mentioner-only Retry.
  @MainActor struct MentionThoughtShellRowTests {
    private func shell(id: String, metadata: [String: any Sendable]) throws -> Components.Schemas.ChatRoomMessage {
      try .init(
        id: id,
        roomId: "room",
        parentMessageId: nil,
        content: "",
        createdAt: Date(timeIntervalSince1970: 1_788_868_800),
        deletedAt: nil,
        editedAt: nil,
        sender: .case2(.init(_type: .coworker, coworker: .init(id: "cow_1", name: "Elena", slug: "elena", caption: nil, image: nil, presence: .online))),
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

    @Test(arguments: [false, true])
    func thinkingAndFailedShellsFitTheTranscript(dark: Bool) async throws {
      let beats = [["type": "reasoning", "text": "Reading the last three release notes"], ["type": "reasoning", "text": "Comparing the registration counts for the last 30 days against the previous period, one row per organization"]]
      let thinking = try shell(id: "thinking", metadata: ["streaming": true, "mention_id": "mention_1", "thought_timing_ms": ["start": 1_788_868_800_000]])
      let beating = try shell(id: "beating", metadata: ["streaming": true, "mention_id": "mention_2", "reasoning": beats, "thought_timing_ms": ["start": 1_788_868_800_000]])
      let failed = try shell(id: "failed", metadata: ["mention_id": "mention_3", "mention_failed": true, "in_reply_to_message_id": "source"])
      let content = VStack(alignment: .leading, spacing: 12) {
        MessageRowView(message: thinking, row: transcriptRow(thinking), outbound: nil)
        MessageRowView(message: beating, row: transcriptRow(beating), outbound: nil)
        MessageRowView(message: failed, row: transcriptRow(failed), outbound: nil, perform: { _ in nil }, canRetryMention: true)
        MessageRowView(message: failed, row: transcriptRow(failed), outbound: nil, perform: { _ in nil })
      }
      .padding(20)
      .frame(width: 520, alignment: .leading)
      .background(.background)
      .environmentObject(WorkspaceState()).environmentObject(AuthState())
      .environment(\.colorScheme, dark ? .dark : .light)
      let host = NSHostingView(rootView: content)
      host.frame = NSRect(x: 0, y: 0, width: 520, height: 420)
      for _ in 0 ..< 10 {
        host.layoutSubtreeIfNeeded()
        try await Task.sleep(for: .milliseconds(20))
      }
      #expect(host.fittingSize.height < 420)
    }
  }
#endif

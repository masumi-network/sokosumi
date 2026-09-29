#if os(macOS)
  import AppKit
  import CoreAPI
  @testable import Sokosumi
  import SokosumiAuth
  import SokosumiChat
  import SokosumiWorkspace
  import SwiftUI
  import Testing

  /// Row 19a: a deleted message leaves the transcript; only a deleted thread
  /// root still renders "This message was deleted".
  @MainActor struct DeletedMessageRowTests {
    private let base = Date(timeIntervalSince1970: 1_767_268_800)

    private func message(id: String, content: String, name: String, minutes: Double) -> Components.Schemas.ChatRoomMessage {
      var message = chatRoomMessage(from: .init(
        clientTurnId: id, roomId: "room_1", content: content, createdAt: base.addingTimeInterval(minutes * 60),
        sender: .init(id: "user_\(name)", name: name, email: "\(name.lowercased())@example.com", presence: .offline)
      ))
      message.id = id
      message.metadata = nil
      return message
    }

    @Test(arguments: [false, true])
    func transcriptDropsTheDeletedRowAndTheThreadRootKeepsItsTombstone(dark: Bool) async throws {
      let first = message(id: "first", content: "Draft is in the shared folder.", name: "Ada", minutes: 0)
      let deleted = tombstoneTranscriptMessage(message(id: "deleted", content: "Wrong link, sorry", name: "Ben", minutes: 1), now: base)
      let last = message(id: "last", content: "Thanks — reading it now.", name: "Ada", minutes: 2)
      var root = tombstoneTranscriptMessage(message(id: "root", content: "Original question", name: "Ben", minutes: 3), now: base)
      root.threadReplyCount = 1
      let displayed = displayedTranscript(messages: [first, deleted, last], shells: [])
      #expect(displayed.map(\.id) == ["first", "last"])

      let content = VStack(alignment: .leading, spacing: 0) {
        Text("Room transcript").font(.caption).foregroundStyle(.secondary).padding(.bottom, 6)
        ForEach(Array(displayed.enumerated()), id: \.element.id) { index, row in
          MessageRowView(message: row, isContinuation: index > 0, outbound: nil, onRetry: nil, onRemove: nil)
        }
        Divider().padding(.vertical, 10)
        Text("Thread root").font(.caption).foregroundStyle(.secondary).padding(.bottom, 6)
        MessageRowView(message: root, isContinuation: false, outbound: nil, onRetry: nil, onRemove: nil)
      }
      .padding(20)
      .frame(width: 520, alignment: .leading)
      .background(.background)
      .environmentObject(WorkspaceState()).environmentObject(AuthState())
      .environment(\.colorScheme, dark ? .dark : .light)
      let host = NSHostingView(rootView: content)
      host.frame = NSRect(x: 0, y: 0, width: 520, height: 300)
      for _ in 0 ..< 10 {
        host.layoutSubtreeIfNeeded()
        try await Task.sleep(for: .milliseconds(20))
      }
      #expect(host.fittingSize.height < 300)
    }
  }
#endif

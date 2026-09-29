#if os(macOS)
  import AppKit
  @testable import Sokosumi
  import SokosumiAuth
  import SokosumiChat
  import SokosumiWorkspace
  import SwiftUI
  import Testing

  @MainActor struct MessagePinnedLabelTests {
    @Test(arguments: ["en", "de", "es"])
    func pinnedLabelIsLocalized(locale: String) throws {
      let path = try #require(Bundle.main.path(forResource: locale, ofType: "lproj"))
      let bundle = try #require(Bundle(path: path))
      let expected = ["en": "Pinned", "de": "Angeheftet", "es": "Fijado"]
      #expect(bundle.localizedString(forKey: "Pinned", value: nil, table: "ChatPins") == expected[locale])
    }

    @Test(arguments: [false, true])
    func pinLabelFitsHeaderAndContinuation(dark: Bool) async throws {
      var message = chatRoomMessage(from: .init(clientTurnId: "fixture", roomId: "room", content: "A pinned channel message.",
                                                sender: .init(id: "person", name: "Example Person", email: "person@example.com", presence: .offline)))
      message.id = "fixture"
      let content = VStack(alignment: .leading, spacing: 20) {
        MessageRowView(message: message, isContinuation: false, outbound: nil, onRetry: nil, onRemove: nil, isPinned: true)
        MessageRowView(message: message, isContinuation: true, outbound: nil, onRetry: nil, onRemove: nil, isPinned: true)
        MessageRowView(message: message, isContinuation: false, outbound: nil, onRetry: nil, onRemove: nil)
      }
      .padding(20)
      .frame(width: 520, alignment: .leading)
      .background(.background)
      .environmentObject(WorkspaceState()).environmentObject(AuthState())
      .environment(\.locale, Locale(identifier: "de"))
      .environment(\.colorScheme, dark ? .dark : .light)
      let host = NSHostingView(rootView: content)
      host.frame = NSRect(x: 0, y: 0, width: 520, height: 260)
      for _ in 0 ..< 10 {
        host.layoutSubtreeIfNeeded()
        try await Task.sleep(for: .milliseconds(20))
      }
      #expect(host.fittingSize.height < 260)
    }
  }
#endif

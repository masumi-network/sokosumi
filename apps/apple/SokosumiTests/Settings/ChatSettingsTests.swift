#if os(macOS)
  import AppKit
  @testable import Sokosumi
  import SokosumiAuth
  import SokosumiChat
  import SokosumiWorkspace
  import SwiftUI
  import Testing

  @MainActor
  struct ChatSettingsTests {
    /// The environment default keeps system formatting until the reader chooses.
    @Test func timeFormatEnvironmentDefaultsToAuto() {
      #expect(EnvironmentValues().timeFormat == .auto)
      var values = EnvironmentValues()
      values.timeFormat = .twentyFourHour
      #expect(values.timeFormat == .twentyFourHour)
    }

    @Test(arguments: [false, true])
    func settingsAndUnreadCountFixtureRenders(dark: Bool) async throws {
      var message = chatRoomMessage(from: .init(
        clientTurnId: "fixture", roomId: "room", content: "Same message, the reader's clock.",
        sender: .init(id: "user_2", name: "Ada Lovelace", email: "ada@example.com", presence: .online)
      ))
      message.createdAt = Date(timeIntervalSince1970: 1_790_025_200)
      let content = VStack(alignment: .leading, spacing: 12) {
        Form {
          ChatSettingsSection(showsRoomUnreadCount: .constant(true), isSaving: false, isAvailable: true, saveError: nil, timeFormat: .constant(.twentyFourHour))
          ChatSettingsSection(
            showsRoomUnreadCount: .constant(false),
            isSaving: false,
            isAvailable: true,
            saveError: "Could not save that change. Check your connection and try again.",
            timeFormat: .constant(.auto)
          )
        }
        .formStyle(.grouped)
        .frame(height: 420)
        VStack(alignment: .leading, spacing: 6) {
          sidebarName("general", count: 3)
          sidebarName("a-very-long-channel-name-that-truncates-before-the-count", count: 250)
        }
        .frame(width: 220, alignment: .leading)
        .padding(.horizontal, 20)
        ForEach(TimeFormatPreference.allCases) { preference in
          MessageRowView(message: message, isContinuation: false, outbound: nil, onRetry: nil, onRemove: nil)
            .environment(\.timeFormat, preference)
        }
        .padding(.horizontal, 20)
      }
      .padding(.vertical, 12)
      .frame(width: 440, alignment: .leading)
      .background(.background)
      .environmentObject(WorkspaceState()).environmentObject(AuthState())
      .environment(\.colorScheme, dark ? .dark : .light)
      let host = NSHostingView(rootView: content)
      host.frame = NSRect(x: 0, y: 0, width: 440, height: 760)
      for _ in 0 ..< 10 {
        host.layoutSubtreeIfNeeded()
        try await Task.sleep(for: .milliseconds(20))
      }
      #expect(host.fittingSize.height <= 760)
    }

    private func sidebarName(_ name: String, count: Int) -> some View {
      HStack(alignment: .firstTextBaseline, spacing: 6) {
        Text(name).lineLimit(1).fontWeight(.bold)
        RoomUnreadCountLabel(count: count)
      }
    }
  }
#endif

#if os(macOS)
  import AppKit
  @testable import Sokosumi
  import SokosumiChat
  import SwiftUI
  import Testing

  extension NativeWindowTests {
    /// SOK-1258: web's members-panel toasts as a notice under the roster, at the inspector's narrowest width.
    @MainActor struct ChannelMembershipNoticeBarTests {
      private static let notices: [ChannelMembershipNotice] = [
        .removed(.coworker("agent"), name: "Research assistant"),
        .removed(.human("guest"), name: "Priya Natarajan"),
        .added(count: 2)
      ]

      private func render(_ notice: ChannelMembershipNotice, dark: Bool) -> (NSHostingView<some View>, NSWindow) {
        let content = ChannelMembershipNoticeBar(notice: notice, serial: 1, undoDisabled: false, undo: { _ in }, dismiss: {})
          .frame(width: 280)
          .background(.background)
          .environment(\.colorScheme, dark ? .dark : .light)
        let host = NSHostingView(rootView: content)
        let window = NSWindow(contentRect: NSRect(origin: .zero, size: host.fittingSize), styleMask: [.titled], backing: .buffered, defer: false)
        window.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        window.contentView = host
        window.orderFront(nil)
        host.layoutSubtreeIfNeeded()
        return (host, window)
      }

      /// Undo shows only for the agent; every notice reads in full. Recorded light beside dark.
      @Test func rendersEachNoticeAtTheNarrowestInspector() async throws {
        var columns: [[CGImage]] = []
        for dark in [false, true] {
          var column: [CGImage] = []
          for notice in Self.notices {
            let (host, window) = render(notice, dark: dark)
            defer { window.orderOut(nil) }
            try await Task.sleep(for: .milliseconds(50))
            host.layoutSubtreeIfNeeded()
            let bitmap = try #require(host.bitmapImageRepForCachingDisplay(in: host.bounds))
            host.cacheDisplay(in: host.bounds, to: bitmap)
            try CreateChannelGuidanceTests.expectWindowBackground(bitmap, dark: dark)
            if let lines = try CreateChannelGuidanceTests.recognizedLines(in: bitmap) {
              let text = lines.joined(separator: " ")
              #expect(text.contains(notice.message.dropLast()), "Vision read \(lines)")
              #expect(text.contains("Undo") == (notice.undo != nil), "Vision read \(lines)")
            }
            try column.append(#require(bitmap.cgImage))
          }
          columns.append(column)
        }
        let combined = try RoomHeaderTests.stitched(columns)
        try Attachment.record(#require(combined.representation(using: .png, properties: [:])), named: "channel-membership-notices.png")
      }
    }
  }
#endif

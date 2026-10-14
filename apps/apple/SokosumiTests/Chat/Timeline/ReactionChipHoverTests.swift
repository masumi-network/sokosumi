#if os(macOS)
  import AppKit
  import CoreAPI
  @testable import Sokosumi
  import SokosumiAuth
  import SokosumiChat
  import SokosumiWorkspace
  import SwiftUI
  import Testing

  extension NativeWindowTests {
    /// M10: a reaction chip says who reacted the moment the pointer is on it, as web's chip tooltip does
    /// (`delayDuration = 0`), and a chip that takes a tap fills on hover (web `hover:bg-muted`). The native `.help`
    /// tooltip waited a second or more. The test host builds no accessibility tree, so both are read from pixels: the
    /// band above the chip, where only the label draws, and the chip's padding left of its emoji, which only the fill
    /// changes. Keyboard focus also shows the label, but no test here drives it: the host is never active or key, and a
    /// chip takes focus only with Keyboard navigation on, which `NSApp.isFullKeyboardAccessEnabled` reads from the
    /// global setting alone (a volatile `AppleKeyboardUIMode` changes nothing), so Tab never reaches it.
    @MainActor struct ReactionChipHoverTests {
      private static let top: CGFloat = 40
      private static let leading: CGFloat = 12
      private static let width: CGFloat = 360

      private static let reaction = Components.Schemas.ChatRoomMessageReaction(
        emoji: "👍", count: 2, reactedByCurrentUser: false, reactors: [.init(id: "u1", name: "Ada"), .init(id: "u2", name: "Bob")]
      )

      private static func host(toggle: ((String) -> Void)?, activity: TranscriptScrollActivity = TranscriptScrollActivity()) async throws
        -> (NSHostingView<AnyView>, NSWindow) {
        let host = NSHostingView(rootView: AnyView(MessageReactionsView(reactions: [reaction], toggle: toggle)
            .whoReactedLabel()
            .padding(.top, top)
            .padding(.leading, leading)
            .padding(.bottom, 8)
            .frame(width: width, alignment: .topLeading)
            .background(.background)
            .environment(\.transcriptScrollActivity, activity)
            .environment(\.colorScheme, .light)))
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: width, height: 100), styleMask: [.titled], backing: .buffered, defer: false)
        window.appearance = NSAppearance(named: .aqua)
        window.contentView = host
        window.makeKeyAndOrderFront(nil)
        for _ in 0 ..< 8 {
          host.layoutSubtreeIfNeeded()
          try await Task.sleep(for: .milliseconds(20))
        }
        return (host, window)
      }

      private static func draw(_ host: NSView) throws -> NSBitmapImageRep {
        host.layoutSubtreeIfNeeded()
        let bitmap = try #require(host.bitmapImageRepForCachingDisplay(in: host.bounds))
        host.cacheDisplay(in: host.bounds, to: bitmap)
        return bitmap
      }

      private static func luminance(_ bitmap: NSBitmapImageRep, _ column: Int, _ row: Int) -> CGFloat {
        guard let color = bitmap.colorAt(x: column, y: row)?.usingColorSpace(.deviceRGB) else { return 0 }
        return 0.2126 * color.redComponent + 0.7152 * color.greenComponent + 0.0722 * color.blueComponent
      }

      /// What hovering changed against the unhovered drawing: a label above the chip, a fill inside it.
      private static func chrome(_ drawn: NSBitmapImageRep, plain: NSBitmapImageRep) -> (label: Bool, fill: Bool) {
        let scale = CGFloat(drawn.pixelsWide) / width
        let band = Int(4 * scale) ..< Int((top - 2) * scale)
        let label = (0 ..< drawn.pixelsWide).contains { column in
          band.contains { abs(luminance(drawn, column, $0) - luminance(plain, column, $0)) > 0.06 }
        }
        // Left of the emoji, inside the capsule: the chip's 8 pt padding at its vertical middle.
        let column = Int((leading + 5) * scale)
        let fill = (Int((top + 10) * scale) ..< Int((top + 14) * scale)).contains {
          abs(luminance(drawn, column, $0) - luminance(plain, column, $0)) > 0.015
        }
        return (label, fill)
      }

      private static var chip: NSPoint {
        NSPoint(x: leading + 20, y: top + 12)
      }

      @Test func hoveringAChipSaysWhoReactedAndFillsIt() async throws {
        let (host, window) = try await Self.host(toggle: { _ in })
        defer { window.orderOut(nil) }
        let plain = try Self.draw(host)
        try await hover(Self.chip, in: host, window: window)
        let seen = try Self.chrome(Self.draw(host), plain: plain)
        #expect(seen.label, "Who reacted shows above the chip")
        #expect(seen.fill, "The chip fills under the pointer")
      }

      /// Web's `aria-disabled` chip (a Read-only Direct): still says who reacted, but takes no tap, so no fill.
      @Test func aChipThatTakesNoTapSaysWhoReactedWithoutFilling() async throws {
        let (host, window) = try await Self.host(toggle: nil)
        defer { window.orderOut(nil) }
        let plain = try Self.draw(host)
        try await hover(Self.chip, in: host, window: window)
        let seen = try Self.chrome(Self.draw(host), plain: plain)
        #expect(seen.label, "Who reacted shows above the chip")
        #expect(!seen.fill, "No fill on a chip that takes no tap")
      }

      @Test func aPointerBesideTheChipShowsNothing() async throws {
        let (host, window) = try await Self.host(toggle: { _ in })
        defer { window.orderOut(nil) }
        let plain = try Self.draw(host)
        try await hover(NSPoint(x: Self.width - 40, y: Self.top + 12), in: host, window: window)
        let seen = try Self.chrome(Self.draw(host), plain: plain)
        #expect(!seen.label && !seen.fill, "Nothing shows off the chip: \(seen)")
      }

      /// M8: a chip carried under a resting pointer by a scroll stays plain, as the row's chrome does.
      @Test func nothingShowsWhileTheTranscriptScrolls() async throws {
        let activity = TranscriptScrollActivity()
        activity.isScrolling = true
        let (host, window) = try await Self.host(toggle: { _ in }, activity: activity)
        defer { window.orderOut(nil) }
        let plain = try Self.draw(host)
        try await hover(Self.chip, in: host, window: window)
        let seen = try Self.chrome(Self.draw(host), plain: plain)
        #expect(!seen.label && !seen.fill, "Nothing shows while scrolling: \(seen)")
      }

      /// A scroll that starts under a pointer already resting on the chip takes the label and fill at once.
      @Test func aScrollStartingUnderThePointerHidesTheLabel() async throws {
        let activity = TranscriptScrollActivity()
        let (host, window) = try await Self.host(toggle: { _ in }, activity: activity)
        defer { window.orderOut(nil) }
        let plain = try Self.draw(host)
        try await hover(Self.chip, in: host, window: window)
        let shown = try Self.chrome(Self.draw(host), plain: plain)
        try #require(shown.label && shown.fill, "The label showed before scrolling: \(shown)")
        activity.isScrolling = true
        let scrolling = try Self.chrome(Self.draw(host), plain: plain)
        #expect(!scrolling.label && !scrolling.fill, "Scrolling hides both: \(scrolling)")
      }

      /// The product path: `MessageRowView` draws the label over its own body, where a removed `whoReactedLabel()`
      /// on the row would leave the chip's preference unread. The bar waits a minute, so only the label can change
      /// the band above the chip. The chip is found in the plain drawing: the lowest drawn line under the text column.
      @Test func theRowDrawsTheLabelOverItsBody() async throws {
        var message = chatRoomMessage(from: .init(clientTurnId: "chip", roomId: "room_1", content: "Hello",
                                                  createdAt: Date(timeIntervalSince1970: 1_790_251_200),
                                                  sender: .init(id: "user_2", name: "Phil", email: "phil@example.com", presence: .online)))
        message.id = "message_1"
        message.reactions = [Self.reaction]
        let row = MessageRowView(message: message, row: transcriptRow(message), outbound: nil, perform: { _ in nil }, horizontalInset: 12)
        let host = NSHostingView(rootView: AnyView(row
            .environment(\.messageHoverDelay, .seconds(60))
            .padding(.vertical, 8)
            .frame(width: Self.width, alignment: .topLeading)
            .background(.background)
            .environmentObject(WorkspaceState()).environmentObject(AuthState())
            .environment(\.colorScheme, .light)
            .environment(\.locale, Locale(identifier: "en_US"))))
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: Self.width, height: 120), styleMask: [.titled], backing: .buffered, defer: false)
        window.appearance = NSAppearance(named: .aqua)
        window.contentView = host
        window.makeKeyAndOrderFront(nil)
        defer { window.orderOut(nil) }
        for _ in 0 ..< 8 {
          host.layoutSubtreeIfNeeded()
          try await Task.sleep(for: .milliseconds(20))
        }
        let plain = try Self.draw(host)
        let scale = CGFloat(plain.pixelsWide) / Self.width
        // The text column starts at 12 inset + 28 avatar + 14 spacing.
        let columns = Int(54 * scale) ..< Int(120 * scale)
        let chipBottom = try #require((0 ..< plain.pixelsHigh).reversed().first { line in
          columns.contains { Self.luminance(plain, $0, line) < 0.9 }
        }, "The chip is drawn")
        let chipTop = CGFloat(chipBottom) / scale - 24
        try await hover(NSPoint(x: 74, y: chipTop + 12), in: host, window: window)
        let drawn = try Self.draw(host)
        let band = Int((chipTop - 26) * scale) ..< Int((chipTop - 2) * scale)
        let label = columns.contains { column in
          band.contains { abs(Self.luminance(drawn, column, $0) - Self.luminance(plain, column, $0)) > 0.06 }
        }
        #expect(label, "The row draws who reacted above the chip, over its body")
      }
    }
  }
#endif

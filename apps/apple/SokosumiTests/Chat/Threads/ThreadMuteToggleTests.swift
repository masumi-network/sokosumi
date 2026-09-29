#if os(macOS)
  import AppKit
  import CoreAPI
  import HTTPTypes
  import OpenAPIRuntime
  @testable import Sokosumi
  import SokosumiChat
  import SwiftUI
  import Testing

  @MainActor private final class ToggleCount {
    var value = 0
  }

  extension NativeWindowTests {
    /// Row 24b: the thread view's mute toggle, the muted marker in the thread overview and the inline
    /// failure row. SwiftUI draws these without an `NSView` and the test host builds no accessibility
    /// tree, so the tests click by position and compare pixels.
    @MainActor struct ThreadMuteToggleTests {
      /// The real window toolbar, as the thread view declares it, bridged from SwiftUI into `NSToolbar`.
      @Test(arguments: [false, true], [false, true])
      func theThreadToolbarCarriesTheToggle(dark: Bool, muted: Bool) async throws {
        let content = NavigationStack {
          Text("Replies")
            .frame(width: 420, height: 120)
            .navigationTitle("Thread")
            .toolbar {
              ToolbarItem {
                ThreadMuteToggle(isMuted: muted, isPending: false) {}
              }
            }
        }
        let controller = NSHostingController(rootView: content)
        controller.sceneBridgingOptions = [.toolbars, .title]
        let window = NSWindow(contentViewController: controller)
        window.title = "Thread"
        window.styleMask = [.titled, .closable]
        window.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        window.setContentSize(NSSize(width: 420, height: 120))
        window.makeKeyAndOrderFront(nil)
        defer { window.orderOut(nil) }
        let clock = ContinuousClock()
        let deadline = clock.now.advanced(by: .seconds(5))
        while window.toolbar?.items.isEmpty ?? true, clock.now < deadline {
          try await Task.sleep(for: .milliseconds(20))
        }
        let items = try #require(window.toolbar?.items, "The thread view puts its controls in the window toolbar.")
        #expect(!items.isEmpty)
        try await Task.sleep(for: .milliseconds(200))
        let frame = try #require(window.contentView?.superview)
        frame.layoutSubtreeIfNeeded()
        let bitmap = try #require(frame.bitmapImageRepForCachingDisplay(in: frame.bounds))
        frame.cacheDisplay(in: frame.bounds, to: bitmap)
        try Attachment.record(#require(bitmap.representation(using: .png, properties: [:])),
                              named: "thread-toolbar-\(muted ? "muted" : "unmuted")-\(dark ? "dark" : "light").png")
      }

      @Test(arguments: [false, true])
      func aClickAsksOnce(muted: Bool) async throws {
        #expect(try await Self.clicks(muted: muted, pending: false) == 1)
      }

      /// Web disables the button while the write runs, so a second click cannot race the first.
      @Test func aPendingToggleIgnoresClicks() async throws {
        #expect(try await Self.clicks(muted: true, pending: false) == 1)
        #expect(try await Self.clicks(muted: true, pending: true) == 0)
      }

      /// Muted and unmuted draw differently: the toggle stays pressed and the bell is struck through.
      @Test(arguments: [false, true])
      func theMutedStateDrawsDifferently(dark: Bool) throws {
        let unmuted = try Self.render(ThreadMuteToggle(isMuted: false, isPending: false) {}.frame(width: 44, height: 44), width: 60, dark: dark)
        let muted = try Self.render(ThreadMuteToggle(isMuted: true, isPending: false) {}.frame(width: 44, height: 44), width: 60, dark: dark)
        try #require(unmuted.pixelsWide == muted.pixelsWide && unmuted.pixelsHigh == muted.pixelsHigh)
        #expect(Self.differingPixels(unmuted, muted).count > 20)
      }

      @Test(arguments: [false, true])
      func theFailureRowFitsTheThreadColumn(dark: Bool) throws {
        let row = ThreadMuteFailureRow(message: ThreadMuteState.Failure.unmute.message) {}
        let bitmap = try Self.render(row, width: 420, dark: dark)
        try Attachment.record(#require(bitmap.representation(using: .png, properties: [:])), named: "thread-mute-failure-\(dark ? "dark" : "light").png")
        #expect(bitmap.pixelsWide > 0)
      }

      @Test func dismissingTheFailureRowCallsBack() async throws {
        let count = ToggleCount()
        let host = NSHostingView(rootView: ThreadMuteFailureRow(message: "Could not mute this thread.") { count.value += 1 }.frame(width: 420))
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 420, height: 40), styleMask: [.titled], backing: .buffered, defer: false)
        defer { window.orderOut(nil) }
        window.contentView = host
        window.makeKeyAndOrderFront(nil)
        let bitmap = try fittedBitmap(of: host, in: window)
        let scale = CGFloat(bitmap.pixelsWide) / host.bounds.width
        // The dismiss button is the trailing control, inside the row's 16 pt padding.
        clickPixel(CGPoint(x: (host.bounds.width - 24) * scale, y: CGFloat(bitmap.pixelsHigh) / 2), of: bitmap, drawnFrom: host, in: window)
        try await Task.sleep(for: .milliseconds(200))
        #expect(count.value == 1)
      }

      /// Web marks a muted thread in the overview with a muted glyph labelled "Muted", between the preview
      /// and the time. The marker is the only difference between the two renders, and it sits there. The
      /// muted thread is the read one, so it lists under Earlier, below the unread row (row 24d).
      @Test(arguments: [false, true])
      func theOverviewMarksOnlyTheMutedThread(dark: Bool) async throws {
        let muted = try await Self.overview(firstMuted: true, dark: dark, record: true)
        let unmuted = try await Self.overview(firstMuted: false, dark: dark, record: false)
        let changed = Self.differingPixels(muted, unmuted)
        try #require(!changed.isEmpty, "The muted row draws a marker.")
        let scale = CGFloat(muted.pixelsWide) / 280
        let box = changed.reduce(CGRect.null) { $0.union(CGRect(x: $1.x, y: $1.y, width: 1, height: 1)) }
        #expect(box.minX > 140 * scale, "The marker sits on the trailing side, before the time: \(box).")
        #expect(box.minY > 150 * scale, "Only the read row under Earlier changes: \(box).")
        #expect(box.width < 24 * scale && box.height < 24 * scale, "One caption-sized glyph: \(box).")
      }

      // MARK: Helpers

      private static func clicks(muted: Bool, pending: Bool) async throws -> Int {
        let count = ToggleCount()
        let content = ThreadMuteToggle(isMuted: muted, isPending: pending) { count.value += 1 }
          .padding(16)
          .background(.background)
        let host = NSHostingView(rootView: content)
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 80, height: 60), styleMask: [.titled], backing: .buffered, defer: false)
        defer { window.orderOut(nil) }
        window.contentView = host
        window.makeKeyAndOrderFront(nil)
        let bitmap = try fittedBitmap(of: host, in: window)
        clickPixel(CGPoint(x: CGFloat(bitmap.pixelsWide) / 2, y: CGFloat(bitmap.pixelsHigh) / 2), of: bitmap, drawnFrom: host, in: window)
        try await Task.sleep(for: .milliseconds(200))
        return count.value
      }

      private static func render(_ view: some View, width: CGFloat, dark: Bool) throws -> NSBitmapImageRep {
        let host = NSHostingView(rootView: view
          .padding(8)
          .frame(width: width)
          .background(.background)
          .environment(\.colorScheme, dark ? .dark : .light))
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: width, height: 60), styleMask: [.titled], backing: .buffered, defer: false)
        defer { window.orderOut(nil) }
        window.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        window.contentView = host
        window.orderFront(nil)
        return try fittedBitmap(of: host, in: window)
      }

      private static func overview(firstMuted: Bool, dark: Bool, record: Bool) async throws -> NSBitmapImageRep {
        let sender = Components.Schemas.ChatRoomUserParticipant(id: "user", name: "Ada Lovelace", email: "ada@example.com", presence: .online)
        var first = chatRoomMessage(from: OutboundShell(clientTurnId: "first", roomId: "room", content: "Release checklist", sender: sender))
        first.id = "first"
        var second = first
        second.id = "second"
        second.content = "Design review notes"
        let reference = Date(timeIntervalSince1970: 1_790_000_000)
        let threads = [
          Components.Schemas.ChatRoomThread(parentMessage: first, replyCount: 4, lastReplyAt: reference, unreadReplyCount: 0, hasLooked: true,
                                            mutedAt: firstMuted ? reference : nil),
          Components.Schemas.ChatRoomThread(parentMessage: second, replyCount: 1, lastReplyAt: reference, unreadReplyCount: 1, hasLooked: true)
        ]
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .custom { date, encoder in
          let formatter = ISO8601DateFormatter()
          formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
          var value = encoder.singleValueContainer()
          try value.encode(formatter.string(from: date))
        }
        let rows = try #require(String(bytes: encoder.encode(threads), encoding: .utf8))
        let transport = MuteOverviewTransport(body: "{\"data\":\(rows),\"meta\":{\"timestamp\":\"2026-09-23T12:00:00.000Z\",\"requestId\":\"fixture\",\"pagination\":{\"cursor\":null,\"limit\":50,\"total\":2,\"nextCursor\":null}}}")
        let overview = RoomThreadOverview()
        try await overview.load(client: Client.connecting(to: #require(URL(string: "https://example.com")), transport: transport), roomId: "room", organizationSlug: nil)
        try #require(overview.items.count == 2)
        let host = NSHostingView(rootView: RoomThreadOverviewView(overview: overview, open: { _ in }, older: {}, markAllRead: {}, retry: {}, close: {})
          .frame(width: 280, height: 260).background(.background)
          .environment(\.colorScheme, dark ? .dark : .light))
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 280, height: 260), styleMask: [.titled], backing: .buffered, defer: false)
        defer { window.orderOut(nil) }
        window.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        window.contentView = host
        window.orderFront(nil)
        for _ in 0 ..< 10 {
          host.layoutSubtreeIfNeeded()
          try await Task.sleep(for: .milliseconds(20))
        }
        let bitmap = try fittedBitmap(of: host, in: window)
        if record {
          try Attachment.record(#require(bitmap.representation(using: .png, properties: [:])), named: "thread-overview-muted-\(dark ? "dark" : "light").png")
        }
        return bitmap
      }

      /// Pixels whose colour differs by more than 0.1 in any channel, as bitmap coordinates (origin top left).
      private static func differingPixels(_ lhs: NSBitmapImageRep, _ rhs: NSBitmapImageRep) -> [(x: Int, y: Int)] {
        guard lhs.pixelsWide == rhs.pixelsWide, lhs.pixelsHigh == rhs.pixelsHigh else { return [(0, 0)] }
        var result: [(x: Int, y: Int)] = []
        for row in 0 ..< lhs.pixelsHigh {
          for column in 0 ..< lhs.pixelsWide {
            guard let left = lhs.colorAt(x: column, y: row)?.usingColorSpace(.sRGB),
                  let right = rhs.colorAt(x: column, y: row)?.usingColorSpace(.sRGB) else { continue }
            if max(abs(left.redComponent - right.redComponent), abs(left.greenComponent - right.greenComponent),
                   abs(left.blueComponent - right.blueComponent)) > 0.1 {
              result.append((column, row))
            }
          }
        }
        return result
      }
    }
  }

  private nonisolated struct MuteOverviewTransport: ClientTransport {
    let body: String
    func send(_: HTTPRequest, body _: HTTPBody?, baseURL _: URL, operationID _: String) async throws -> (HTTPResponse, HTTPBody?) {
      (HTTPResponse(status: .ok), HTTPBody(body))
    }
  }
#endif

#if os(macOS)
  import AppKit
  @testable import Sokosumi
  import SokosumiChat
  import SwiftUI
  import Testing

  extension NativeWindowTests {
    @MainActor struct StartDirectViewTests {
      @Test(arguments: [false, true])
      func recipientListLoadsInNativeWindow(dark: Bool) async throws {
        var loads = 0
        let content = StartDirectView(hasOrganization: true, currentUserId: "me", load: {
          loads += 1
          return .init(targets: [
            .init(id: .human("one"), name: "Alexandra Long Recipient Name", detail: "alexandra@example.com"),
            .init(id: .human("two"), name: "Sam Rivera", detail: "sam@example.com"),
            .init(id: .coworker("helper"), name: "Research assistant", detail: "Research and analysis"),
            .init(id: .sokoBot("bot"), name: "Personal assistant")
          ])
        }, open: { _ in
          Issue.record("Rendering must not create a conversation")
          return false
        })
        .frame(width: 420, height: 500)
        .background(.background)
        .environment(\.colorScheme, dark ? .dark : .light)
        let host = NSHostingView(rootView: content)
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 420, height: 500), styleMask: [.titled], backing: .buffered, defer: false)
        window.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        window.contentView = host
        window.orderFront(nil)
        defer { window.orderOut(nil) }
        for _ in 0 ..< 100 where loads == 0 {
          try await Task.sleep(for: .milliseconds(10))
        }
        #expect(loads == 1)
        try await Task.sleep(for: .milliseconds(200))
        host.layoutSubtreeIfNeeded()
      }

      /// Row 27c: web's picker lists Message yourself first among the people, with "You · {name}" under it, and once
      /// it is chosen it is the one chip and every other row is unavailable (`create-direct-dialog.tsx`:51-138). The
      /// click and the reading need Vision, which runs only locally; CI checks the load.
      @Test(arguments: [false, true])
      func messageYourselfIsListedAndChosenAlone(dark: Bool) async throws {
        var loads = 0
        let content = StartDirectView(hasOrganization: true, currentUserId: "me", load: {
          loads += 1
          return .init(targets: [
            .messageYourself(userId: "me", name: "Ada Lovelace", imageURL: nil),
            .init(id: .human("francis"), name: "Francis Bacon", detail: "francis@example.com"),
            .init(id: .coworker("helper"), name: "Research assistant", detail: "Research and analysis")
          ])
        }, open: { _ in
          Issue.record("Choosing a recipient must not create a conversation")
          return false
        })
        .frame(width: 420, height: 440)
        .background(.background)
        .environment(\.colorScheme, dark ? .dark : .light)
        .environment(\.locale, Locale(identifier: "en"))
        let size = NSRect(x: 0, y: 0, width: 420, height: 440)
        let host = NSHostingView(rootView: content)
        let window = NSWindow(contentRect: size, styleMask: [.titled], backing: .buffered, defer: false)
        window.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        window.contentView = host
        window.orderFront(nil)
        defer { window.orderOut(nil) }
        for _ in 0 ..< 100 where loads == 0 {
          try await Task.sleep(for: .milliseconds(10))
        }
        #expect(loads == 1)
        try await Task.sleep(for: .milliseconds(300))
        host.layoutSubtreeIfNeeded()
        guard let listed = try RoomThreadOverviewGroupsViewTests.recognizedText(in: Self.bitmap(host)) else { return }
        let entry = try #require(listed.first { $0.text == "Message yourself" }, "Listed: \(listed.map(\.text))")
        #expect(listed.contains { $0.text.hasPrefix("You") && $0.text.hasSuffix("Ada Lovelace") }, "\(listed.map(\.text))")
        // First among the people: above Francis.
        let francis = try #require(listed.first { $0.text == "Francis Bacon" })
        #expect(entry.box.midY > francis.box.midY)

        Self.click(in: window, host: host, normalizedBox: entry.box)
        try await Task.sleep(for: .milliseconds(300))
        host.layoutSubtreeIfNeeded()
        let bitmap = try Self.bitmap(host)
        try Attachment.record(#require(bitmap.representation(using: .png, properties: [:])),
                              named: "message-yourself-picker-\(dark ? "dark" : "light").png")
        let chosen = try #require(try RoomThreadOverviewGroupsViewTests.recognizedText(in: bitmap))
        // The chip names it, and the field offers to replace rather than add.
        #expect(chosen.contains { $0.text == "Message yourself" }, "\(chosen.map(\.text))")
        #expect(chosen.contains { $0.text == "Replace recipient" }, "\(chosen.map(\.text))")
        #expect(!chosen.contains { $0.text.hasPrefix("You") && $0.text.hasSuffix("Ada Lovelace") }, "The row left the list: \(chosen.map(\.text))")
      }

      private static func bitmap(_ host: NSView) throws -> NSBitmapImageRep {
        let bitmap = try #require(host.bitmapImageRepForCachingDisplay(in: host.bounds))
        host.cacheDisplay(in: host.bounds, to: bitmap)
        return bitmap
      }

      /// A click at a Vision box: normalized, origin bottom-left, the window's own frame for a content view that fills it.
      private static func click(in window: NSWindow, host: NSView, normalizedBox box: CGRect) {
        let point = NSPoint(x: box.midX * host.bounds.width, y: box.midY * host.bounds.height)
        for type in [NSEvent.EventType.leftMouseDown, .leftMouseUp] {
          guard let event = NSEvent.mouseEvent(with: type, location: point, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
                                               windowNumber: window.windowNumber, context: nil, eventNumber: 0, clickCount: 1, pressure: 1) else { continue }
          window.sendEvent(event)
        }
      }
    }
  }
#endif

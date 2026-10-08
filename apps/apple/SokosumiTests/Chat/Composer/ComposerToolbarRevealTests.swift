#if os(macOS)
  import AppKit
  @testable import Sokosumi
  import SokosumiChat
  import SwiftUI
  import Testing

  extension NativeWindowTests {
    /// Row 11a, web's `openLinkDialog`: ⌘K opens the link editor and shows a hidden formatting bar for this
    /// composer only. The bar stays after the editor closes, and the stored preference stays hidden. Each case
    /// gives the composer its own preference store, so nothing here touches the app's defaults.
    @MainActor struct ComposerToolbarRevealTests {
      /// The room composer, light and dark; the renders are PARITY's 11a fixture image.
      @Test(arguments: [false, true])
      func commandKShowsTheHiddenBarInTheRoomComposer(dark: Bool) async throws {
        try await reveal(dark: dark, editing: false)
      }

      /// The edit composer keeps the bar (a recorded 18b deviation), so ⌘K shows it there too.
      @Test func commandKShowsTheHiddenBarInTheEditComposer() async throws {
        try await reveal(dark: false, editing: true)
      }

      private func reveal(dark: Bool, editing: Bool) async throws {
        let suite = "ComposerToolbarRevealTests." + UUID().uuidString
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let preferences = ComposerPreferences(defaults: defaults)
        preferences.toolbarVisible = false

        var text = "Read the release notes"
        let content = VStack {
          Spacer()
          ComposerTextInput(text: Binding(get: { text }, set: { text = $0 }), submit: { false },
                            cancelEdit: editing ? {} : nil)
        }
        .padding(12)
        .frame(width: 480, height: 200)
        .background(Color(nsColor: .windowBackgroundColor))
        .environment(\.colorScheme, dark ? .dark : .light)
        let host = NSHostingView(rootView: content)
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 480, height: 200), styleMask: [.titled], backing: .buffered, defer: false)
        window.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        window.contentView = host
        window.orderFront(nil)
        defer { window.orderOut(nil) }
        let input = try await waitForView(in: host, timeoutMessage: "Composer editor did not appear in the hosting view") {
          Self.textView(in: host) as? MacComposerTextInput.InputView
        }
        let commands = try #require((input.delegate as? MacComposerTextInput.Coordinator)?.parent.commands)
        commands.toolbar = ComposerToolbarVisibility(preferences: preferences)
        try await Self.waitForTexts(in: host, "the bar to hide") { !$0.contains("Bold (⌘B)") && $0.contains("Show formatting") }
        #expect(window.makeFirstResponder(input))
        input.setSelectedRange(NSRange(location: 17, length: 5))
        let hidden = try Self.bitmap(host)

        #expect(try window.performKeyEquivalent(with: Self.commandK(in: window)))
        #expect(commands.linkEditor?.text == "notes")
        #expect(commands.toolbar.isVisible)
        #expect(!preferences.toolbarVisible, "⌘K stores nothing.")

        // Cancel the editor; the bar stays.
        _ = try await waitForView(in: host, timeoutMessage: "The link sheet did not open") { window.attachedSheet.map { _ in host } }
        commands.linkEditor = nil
        _ = try await waitForView(in: host, timeoutMessage: "The link sheet did not close") { window.attachedSheet == nil ? host : nil }
        try await Self.waitForTexts(in: host, "the bar to show") { $0.contains("Bold (⌘B)") && $0.contains("Hide formatting") }
        #expect(commands.toolbar.isVisible)
        #expect(!preferences.toolbarVisible)
        #expect(text == "Read the release notes", "Cancelling changes no text.")
        #expect(ComposerToolbarVisibility(preferences: preferences).isVisible == false, "The next composer starts hidden.")
        let shown = try Self.bitmap(host)
        if !editing {
          try Self.record(hidden, shown, named: "composer-cmd-k-shows-formatting-\(dark ? "dark" : "light").png")
        }
      }

      private static func commandK(in window: NSWindow) throws -> NSEvent {
        try #require(NSEvent.keyEvent(
          with: .keyDown, location: .zero, modifierFlags: .command, timestamp: ProcessInfo.processInfo.systemUptime,
          windowNumber: window.windowNumber, context: nil, characters: "k", charactersIgnoringModifiers: "k",
          isARepeat: false, keyCode: 40
        ))
      }

      /// Throws on timeout, as `waitForView` does, so no later expectation runs on a composer that never got there.
      private static func waitForTexts(in host: NSView, _ what: String, sourceLocation: SourceLocation = #_sourceLocation,
                                       _ ready: ([String]) -> Bool) async throws {
        let clock = ContinuousClock()
        let deadline = clock.now.advanced(by: .seconds(10))
        repeat {
          host.layoutSubtreeIfNeeded()
          if await ready(hostedTexts(in: host)) {
            return
          }
          try await Task.sleep(for: .milliseconds(50))
        } while clock.now < deadline

        host.layoutSubtreeIfNeeded()
        let texts = await hostedTexts(in: host)
        try #require(ready(texts), "Timed out after 10 seconds waiting for \(what); the composer shows \(texts).",
                     sourceLocation: sourceLocation)
      }

      private static func bitmap(_ host: NSView) throws -> NSBitmapImageRep {
        host.layoutSubtreeIfNeeded()
        let bitmap = try #require(host.bitmapImageRepForCachingDisplay(in: host.bounds))
        host.cacheDisplay(in: host.bounds, to: bitmap)
        return bitmap
      }

      /// Before over after, recorded on the result bundle: `xcresulttool export attachments`.
      private static func record(_ top: NSBitmapImageRep, _ bottom: NSBitmapImageRep, named name: String) throws {
        let combined = try #require(NSBitmapImageRep(
          bitmapDataPlanes: nil, pixelsWide: top.pixelsWide, pixelsHigh: top.pixelsHigh + bottom.pixelsHigh,
          bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
          bytesPerRow: 0, bitsPerPixel: 0
        ))
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: combined)
        bottom.draw(in: NSRect(x: 0, y: 0, width: bottom.pixelsWide, height: bottom.pixelsHigh))
        top.draw(in: NSRect(x: 0, y: bottom.pixelsHigh, width: top.pixelsWide, height: top.pixelsHigh))
        NSGraphicsContext.restoreGraphicsState()
        try Attachment.record(#require(combined.representation(using: .png, properties: [:])), named: name)
      }

      private static func textView(in view: NSView) -> NSTextView? {
        if let input = view as? NSTextView {
          return input
        }
        return view.subviews.lazy.compactMap { textView(in: $0) }.first
      }
    }
  }
#endif

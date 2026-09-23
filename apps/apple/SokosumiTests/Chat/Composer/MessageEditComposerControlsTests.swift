#if os(macOS)
  import AppKit
  import CoreAPI
  @testable import Sokosumi
  import SokosumiChat
  import SwiftUI
  import Testing

  /// One drawn control: its bounds in bitmap pixels, how strongly it stands out from the background and
  /// how many of its pixels are coloured.
  private struct DrawnControl {
    let rect: CGRect
    let strength: CGFloat
    let coloredPixels: Int

    var center: CGPoint {
      CGPoint(x: rect.midX, y: rect.midY)
    }
  }

  @MainActor private final class ClickCounts {
    var saves = 0
    var cancels = 0
  }

  extension NativeWindowTests {
    /// Row 18b as refined by the user (2026-09-23): the edit field keeps a pointer path as two compact icon
    /// controls at its trailing edge, Cancel then Save, centred on the first line. Save runs the same commit
    /// as Return, Cancel cancels, and both are disabled while a save is in flight; Save also over the limit.
    /// SwiftUI draws the buttons without an `NSView`, so the tests find them by their pixels.
    @MainActor struct MessageEditComposerControlsTests {
      private static let overLimit = String(repeating: "a", count: ComposerContent.maximumLength + 1)
      private static let patch = "PATCH /v1/chats/rooms/room_1/messages/message_1"

      @Test(arguments: [false, true])
      func drawsCancelThenSaveBesideTheFirstLine(dark: Bool) async throws {
        // The render doubles as PARITY's fixture image; show the formatting bar in both appearances.
        let toolbarWasVisible = ComposerPreferences().toolbarVisible
        ComposerPreferences().toolbarVisible = true
        defer { ComposerPreferences().toolbarVisible = toolbarWasVisible }
        let fixture = try await MessageEditComposerFixture.make(dark: dark)
        defer { fixture.window.orderOut(nil) }
        let draft = "Updated **release notes** for the team."
        fixture.editing.draft = draft
        try await fixture.waitForDraft(draft)
        let bitmap = try fixture.record(named: "message-editing-\(dark ? "dark" : "light").png")
        let controls = try Self.controls(in: fixture, bitmap: bitmap)
        try #require(controls.count == 2, "Found \(controls.map(\.rect)) beside the field.")
        let (cancel, save) = (controls[0], controls[1])
        let scale = fixture.scale(of: bitmap)
        let line = try fixture.firstLineRect(in: bitmap)
        for control in controls {
          #expect(abs(control.rect.midY - line.midY) <= 2 * scale, "\(control.rect) is centred on the first line \(line).")
          #expect(control.rect.height <= line.height + 4 * scale, "\(control.rect) fits one line \(line).")
        }
        #expect(abs(cancel.rect.width - save.rect.width) <= 2 * scale, "Both are the same size: \(cancel.rect), \(save.rect).")
        #expect(save.rect.minX - cancel.rect.maxX >= 2 * scale, "They do not touch.")
        #expect(Self.frameRight(fixture, bitmap: bitmap) - save.rect.maxX >= 8 * scale, "Save keeps its padding from the border.")
        #expect(save.coloredPixels > 20, "Save carries the accent colour (\(save.coloredPixels) coloured pixels).")
        #expect(cancel.coloredPixels < save.coloredPixels / 4, "Cancel is grey (\(cancel.coloredPixels) vs \(save.coloredPixels)).")
      }

      @Test func clickingSaveOnAChangedDraftSaves() async throws {
        EditRequestProtocol.reset()
        let fixture = try await MessageEditComposerFixture.make(client: MessageEditComposerFixture.heldClient())
        defer {
          fixture.editing.reset()
          fixture.window.orderOut(nil)
        }
        fixture.editing.draft = "Changed"
        try await fixture.waitForDraft("Changed")
        let bitmap = try fixture.bitmap()
        let controls = try Self.controls(in: fixture, bitmap: bitmap)
        try #require(controls.count == 2, "Found \(controls.map(\.rect)) beside the field.")
        fixture.click(atPixel: controls[1].center, in: bitmap)
        try await Self.wait("the PATCH") { EditRequestProtocol.requests.contains(Self.patch) }
        // A blur the click may cause runs on the next turn; give it one before checking the edit survived.
        try await Task.sleep(for: .milliseconds(200))
        #expect(fixture.editing.source != nil, "The click saved instead of cancelling.")
        #expect(fixture.editing.isSaving)
        #expect(EditRequestProtocol.requests == [Self.patch])
      }

      @Test(arguments: ["Changed", "Original"])
      func clickingCancelCancels(draft: String) async throws {
        EditRequestProtocol.reset()
        let fixture = try await MessageEditComposerFixture.make(client: MessageEditComposerFixture.heldClient())
        defer { fixture.window.orderOut(nil) }
        fixture.editing.draft = draft
        try await fixture.waitForDraft(draft)
        let bitmap = try fixture.bitmap()
        let controls = try Self.controls(in: fixture, bitmap: bitmap)
        try #require(controls.count == 2, "Found \(controls.map(\.rect)) beside the field.")
        fixture.click(atPixel: controls[0].center, in: bitmap)
        try await Self.wait("the edit to end") { fixture.editing.source == nil }
        #expect(EditRequestProtocol.requests.isEmpty)
      }

      @Test func saveIsDisabledOverTheLimit() async throws {
        EditRequestProtocol.reset()
        let fixture = try await MessageEditComposerFixture.make(client: MessageEditComposerFixture.heldClient())
        defer { fixture.window.orderOut(nil) }
        fixture.editing.draft = "Changed"
        try await fixture.waitForDraft("Changed")
        let enabled = try Self.controls(in: fixture, bitmap: fixture.bitmap())
        try #require(enabled.count == 2, "Found \(enabled.map(\.rect)) beside the field.")

        fixture.editing.draft = Self.overLimit
        try await fixture.waitForDraft(Self.overLimit)
        let bitmap = try fixture.bitmap()
        let controls = try Self.controls(in: fixture, bitmap: bitmap)
        try #require(controls.count == 2, "Found \(controls.map(\.rect)) beside the field.")
        #expect(controls[1].strength < enabled[1].strength * 0.8, "Save dims (\(enabled[1].strength) → \(controls[1].strength)).")
        #expect(controls[0].strength > enabled[0].strength * 0.8, "Cancel stays enabled (\(enabled[0].strength) → \(controls[0].strength)).")
        fixture.click(atPixel: controls[1].center, in: bitmap)
        try await Task.sleep(for: .milliseconds(200))
        #expect(fixture.editing.source != nil, "Still editing.")
        #expect(EditRequestProtocol.requests.isEmpty, "Nothing was sent.")
      }

      @Test func bothAreDisabledWhileSaving() async throws {
        EditRequestProtocol.reset()
        let fixture = try await MessageEditComposerFixture.make(client: MessageEditComposerFixture.heldClient())
        defer {
          fixture.editing.reset()
          fixture.window.orderOut(nil)
        }
        fixture.editing.draft = "Changed"
        try await fixture.waitForDraft("Changed")
        let idle = try Self.controls(in: fixture, bitmap: fixture.bitmap())
        try #require(idle.count == 2, "Found \(idle.map(\.rect)) beside the field.")
        fixture.input.setSelectedRange(NSRange(location: fixture.input.string.utf16.count, length: 0))
        try fixture.input.keyDown(with: MessageEditComposerFixture.returnEvent())
        try await Self.wait("the save to start") { fixture.editing.isSaving && EditRequestProtocol.requests == [Self.patch] }

        let bitmap = try fixture.bitmap()
        let controls = try Self.controls(in: fixture, bitmap: bitmap)
        try #require(controls.count == 2, "Found \(controls.map(\.rect)) beside the field.")
        for (before, now) in zip(idle, controls) {
          #expect(now.strength < before.strength * 0.8, "Dimmed while saving (\(before.strength) → \(now.strength)).")
        }
        fixture.click(atPixel: controls[0].center, in: bitmap)
        fixture.click(atPixel: controls[1].center, in: bitmap)
        try await Task.sleep(for: .milliseconds(200))
        #expect(fixture.editing.source != nil, "Cancel did nothing.")
        #expect(fixture.editing.isSaving)
        #expect(EditRequestProtocol.requests == [Self.patch], "Save sent nothing more.")
      }

      // The composer-level tests above prove the outcome, but `commit()` and `cancel()` already ignore an
      // over-limit draft and a save in flight, so a control that still fired would pass them. These host
      // `MessageEditControls` alone with counting closures.

      @Test func enabledControlsFireOnceEach() async throws {
        let counts = try await Self.clickControls(canSave: true)
        #expect(counts.saves == 1)
        #expect(counts.cancels == 1)
      }

      @Test func aDisabledSaveIgnoresClicksWhileCancelStillFires() async throws {
        let counts = try await Self.clickControls(canSave: false)
        #expect(counts.saves == 0, "The disabled ✓ fired.")
        #expect(counts.cancels == 1)
      }

      /// The composer disables its whole input while a save is in flight.
      @Test func bothIgnoreClicksInsideADisabledComposer() async throws {
        let counts = try await Self.clickControls(canSave: true, composerDisabled: true)
        #expect(counts.saves == 0, "✓ fired inside a disabled composer.")
        #expect(counts.cancels == 0, "✕ fired inside a disabled composer.")
      }

      /// Hosts the controls alone, clicks ✓ then ✕, and returns how often each closure ran.
      private static func clickControls(canSave: Bool, composerDisabled: Bool = false) async throws -> (saves: Int, cancels: Int) {
        let counts = ClickCounts()
        let content = MessageEditControls(canSave: canSave, save: { counts.saves += 1 }, cancel: { counts.cancels += 1 })
          .disabled(composerDisabled)
          .padding(16)
          .background(.background)
        let host = NSHostingView(rootView: content)
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 120, height: 60), styleMask: [.titled], backing: .buffered, defer: false)
        defer { window.orderOut(nil) }
        window.contentView = host
        window.makeKeyAndOrderFront(nil)
        let bitmap = try fittedBitmap(of: host, in: window)
        let scale = CGFloat(bitmap.pixelsWide) / host.bounds.width
        let controls = drawnControls(in: bitmap, region: CGRect(x: 0, y: 0, width: bitmap.pixelsWide, height: bitmap.pixelsHigh), scale: scale)
        try #require(controls.count == 2, "Found \(controls.map(\.rect)).")
        clickPixel(controls[1].center, of: bitmap, drawnFrom: host, in: window)
        clickPixel(controls[0].center, of: bitmap, drawnFrom: host, in: window)
        // A button runs its action on mouse up; give any deferred delivery time before counting.
        try await Task.sleep(for: .milliseconds(200))
        return (counts.saves, counts.cancels)
      }

      /// The inner right edge of the composer frame (16 pt host padding, 1 pt stroke) in pixels.
      private static func frameRight(_ fixture: MessageEditComposerFixture, bitmap: NSBitmapImageRep) -> CGFloat {
        (fixture.host.bounds.width - 16 - 1) * fixture.scale(of: bitmap)
      }

      /// Ink between the field's trailing edge and the frame, in a band around the first line, grouped
      /// into runs of columns, left to right.
      private static func controls(in fixture: MessageEditComposerFixture, bitmap: NSBitmapImageRep) throws -> [DrawnControl] {
        let scale = fixture.scale(of: bitmap)
        let field = fixture.fieldRect(in: bitmap)
        let line = try fixture.firstLineRect(in: bitmap)
        let minX = field.maxX + 1, maxX = frameRight(fixture, bitmap: bitmap) - 1
        let minY = max(0, line.minY - 8 * scale), maxY = min(CGFloat(bitmap.pixelsHigh), line.maxY + 8 * scale)
        return drawnControls(in: bitmap, region: CGRect(x: minX, y: minY, width: maxX - minX, height: maxY - minY), scale: scale)
      }

      /// Ink in `region` (bitmap pixels, origin top left) against its top-right pixel, grouped into runs of
      /// columns at least 4 pt wide, left to right.
      private static func drawnControls(in bitmap: NSBitmapImageRep, region: CGRect, scale: CGFloat) -> [DrawnControl] {
        let minX = Int(region.minX), maxX = Int(region.maxX), minY = Int(region.minY), maxY = Int(region.maxY)
        guard minX < maxX, minY < maxY, let background = bitmap.colorAt(x: maxX - 1, y: minY)?.usingColorSpace(.sRGB) else { return [] }
        func difference(_ column: Int, _ row: Int) -> (ink: CGFloat, colored: Bool) {
          guard let color = bitmap.colorAt(x: column, y: row)?.usingColorSpace(.sRGB) else { return (0, false) }
          let channels = [color.redComponent, color.greenComponent, color.blueComponent]
          let ink = max(abs(color.redComponent - background.redComponent), abs(color.greenComponent - background.greenComponent),
                        abs(color.blueComponent - background.blueComponent))
          return (ink, (channels.max() ?? 0) - (channels.min() ?? 0) > 0.25)
        }
        var runs: [ClosedRange<Int>] = []
        for column in minX ..< maxX where (minY ..< maxY).contains(where: { difference(column, $0).ink > 0.12 }) {
          if let last = runs.last, column - last.upperBound <= 2 {
            runs[runs.count - 1] = last.lowerBound ... column
          } else {
            runs.append(column ... column)
          }
        }
        return runs.filter { $0.count >= Int(4 * scale) }.map { run in
          var top = maxY, bottom = minY, strength: CGFloat = 0, colored = 0
          for column in run {
            for row in minY ..< maxY {
              let pixel = difference(column, row)
              guard pixel.ink > 0.12 else { continue }
              top = min(top, row)
              bottom = max(bottom, row)
              strength = max(strength, pixel.ink)
              colored += pixel.colored ? 1 : 0
            }
          }
          let rect = CGRect(x: run.lowerBound, y: top, width: run.count, height: bottom - top + 1)
          return DrawnControl(rect: rect, strength: strength, coloredPixels: colored)
        }
      }

      private static func wait(_ what: String, _ condition: () -> Bool) async throws {
        let clock = ContinuousClock()
        let deadline = clock.now.advanced(by: .seconds(5))
        while !condition(), clock.now < deadline {
          try await Task.sleep(for: .milliseconds(20))
        }
        #expect(condition(), "Timed out waiting for \(what).")
      }
    }
  }
#endif

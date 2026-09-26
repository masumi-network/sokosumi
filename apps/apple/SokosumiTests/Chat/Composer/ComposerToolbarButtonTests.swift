#if os(macOS)
  import AppKit
  @testable import Sokosumi
  import SwiftUI
  import Testing

  extension NativeWindowTests {
    /// The composer's toolbar icons are outlines in both appearances. `face.smiling` adapts to the colour
    /// scheme: in dark it resolves to a filled disc with cut-out features (what `face.smiling.inverse`
    /// draws in light), so the emoji button stood out as a light-grey disc beside its outlined neighbours.
    @MainActor struct ComposerToolbarButtonTests {
      private static let padding: CGFloat = 8

      /// Only a non-key window: no test window becomes key in the test host, so key-window rendering stays unverified.
      @Test(arguments: [false, true])
      func emojiIconIsAnOutlineInTheNeighboursGrey(dark: Bool) async throws {
        let fixture = try await Self.fixture(dark: dark)
        defer { fixture.window.orderOut(nil) }
        let name = "composer-toolbar-\(dark ? "dark" : "light").png"
        let bitmap = try Self.record(fixture.host, named: name)
        let background = try #require(Self.color(in: bitmap, column: 1, row: 1))
        let emoji = try #require(Self.ink(in: bitmap, button: 0, fixture: fixture, background: background), "The emoji icon did not draw.")
        let neighbour = try #require(Self.ink(in: bitmap, button: 1, fixture: fixture, background: background), "The formatting icon did not draw.")
        let reference = try #require(Self.ink(in: bitmap, button: 2, fixture: fixture, background: background), "The reference icon did not draw.")

        // A disc inks about 78 % of its bounding box, the outlined face about a third.
        #expect(emoji.coverage < 0.5, "\(Int(emoji.coverage * 100)) % of the face's bounds is inked, so it draws as a disc (\(name)).")
        for (label, ink) in [("emoji", emoji), ("formatting", neighbour)] {
          #expect(abs(ink.contrast - reference.contrast) < 0.08,
                  "The \(label) ink (\(ink.contrast)) differs from the plain `.secondary` reference (\(reference.contrast)) (\(name)).")
        }
      }

      /// The emoji button beside the formatting toggle, as `ComposerTextInput` lays them out, alone in a window.
      /// A third cell draws `textformat` the way the toolbar did before the fix, as the independent grey reference.
      private static func fixture(dark: Bool) async throws -> ToolbarFixture {
        let content = HStack(spacing: 0) {
          ComposerToolbarButton(title: "Emoji & Symbols", symbol: "face.smiling") {}
          ComposerToolbarButton(title: "Show formatting", symbol: "textformat") {}
          Image(systemName: "textformat")
            .font(.body)
            .imageScale(.medium)
            .foregroundStyle(.secondary)
            .frame(width: 28, height: 28)
        }
        .padding(padding)
        .background(.background)
        .environment(\.colorScheme, dark ? .dark : .light)
        let host = NSHostingView(rootView: content)
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 80, height: 44), styleMask: [.titled], backing: .buffered, defer: false)
        window.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        window.contentView = host
        window.orderFront(nil)
        let fixture = ToolbarFixture(window: window, host: host)
        _ = try await waitForView(in: host, timeoutMessage: "The toolbar buttons did not draw") {
          window.setContentSize(host.fittingSize)
          host.layoutSubtreeIfNeeded()
          guard let bitmap = try? Self.bitmap(host), let background = Self.color(in: bitmap, column: 1, row: 1) else { return nil }
          return Self.ink(in: bitmap, button: 2, fixture: fixture, background: background) == nil ? nil : host
        }
        return fixture
      }

      /// Measures button `index`'s inked pixels, or nil when it has none.
      private static func ink(in bitmap: NSBitmapImageRep, button index: Int, fixture: ToolbarFixture, background: NSColor) -> ToolbarInk? {
        let scale = CGFloat(bitmap.pixelsWide) / fixture.host.bounds.width
        let side = fixture.host.bounds.height - 2 * padding
        let minX = Int((padding + CGFloat(index) * side) * scale), maxX = Int((padding + CGFloat(index + 1) * side) * scale)
        let minY = Int(padding * scale), maxY = Int((padding + side) * scale)
        let base = luminance(background)
        var inked = 0
        var contrast = 0.0
        var left = Int.max, right = Int.min, top = Int.max, bottom = Int.min
        for row in minY ..< maxY {
          for column in minX ..< maxX {
            guard let pixel = Self.color(in: bitmap, column: column, row: row) else { continue }
            let difference = abs(luminance(pixel) - base)
            guard difference > 0.1 else { continue }
            inked += 1
            contrast = max(contrast, difference)
            left = min(left, column)
            right = max(right, column)
            top = min(top, row)
            bottom = max(bottom, row)
          }
        }
        guard inked > 0 else { return nil }
        let area = Double((right - left + 1) * (bottom - top + 1))
        return ToolbarInk(coverage: Double(inked) / area, contrast: contrast)
      }

      private static func color(in bitmap: NSBitmapImageRep, column: Int, row: Int) -> NSColor? {
        bitmap.colorAt(x: column, y: row)?.usingColorSpace(.sRGB)
      }

      private static func luminance(_ color: NSColor) -> Double {
        Double(0.2126 * color.redComponent + 0.7152 * color.greenComponent + 0.0722 * color.blueComponent)
      }

      private static func bitmap(_ view: NSView) throws -> NSBitmapImageRep {
        let bitmap = try #require(view.bitmapImageRepForCachingDisplay(in: view.bounds))
        view.cacheDisplay(in: view.bounds, to: bitmap)
        return bitmap
      }

      /// Recorded on the result bundle, which the app sandbox cannot hide: `xcresulttool export attachments`.
      private static func record(_ view: NSView, named name: String) throws -> NSBitmapImageRep {
        let bitmap = try bitmap(view)
        try Attachment.record(#require(bitmap.representation(using: .png, properties: [:])), named: name)
        return bitmap
      }
    }
  }

  private struct ToolbarFixture {
    let window: NSWindow
    let host: NSView
  }

  private struct ToolbarInk {
    /// Share of the ink's bounding box that is inked.
    let coverage: Double
    /// The strongest luminance difference from the background.
    let contrast: Double
  }
#endif

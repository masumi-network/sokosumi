#if os(macOS)
  import AppKit
  @testable import Sokosumi
  import SwiftUI
  import Testing

  extension NativeWindowTests {
    /// Text on Iris is always dark, and white is only ever drawn on `AccentColor` (AppKit's choice, which no view can
    /// override), so that one has to carry white.
    @MainActor struct BrandColorsTests {
      private static func resolved(_ name: String, dark: Bool) throws -> NSColor {
        let color = try #require(NSColor(named: name))
        var result = color
        try #require(NSAppearance(named: dark ? .darkAqua : .aqua)).performAsCurrentDrawingAppearance {
          result = color.usingColorSpace(.sRGB) ?? color
        }
        return result
      }

      private static func luminance(_ color: NSColor) -> CGFloat {
        func linear(_ value: CGFloat) -> CGFloat {
          value <= 0.03928 ? value / 12.92 : pow((value + 0.055) / 1.055, 2.4)
        }
        return 0.2126 * linear(color.redComponent) + 0.7152 * linear(color.greenComponent) + 0.0722 * linear(color.blueComponent)
      }

      private static func contrast(_ lhs: CGFloat, _ rhs: CGFloat) -> CGFloat {
        (max(lhs, rhs) + 0.05) / (min(lhs, rhs) + 0.05)
      }

      @Test(arguments: [false, true])
      func brandSolidIsWebsPrimaryUnderDarkText(dark: Bool) throws {
        let color = try Self.resolved("BrandSolid", dark: dark)
        let channels = [color.redComponent, color.greenComponent, color.blueComponent].map { Int(($0 * 255).rounded()) }
        #expect(channels == (dark ? [0xD1, 0x41, 0xD1] : [0xFF, 0x51, 0xFF]))
        let onBrand = Self.luminance(NSColor(Color.onBrand).usingColorSpace(.sRGB) ?? .black)
        #expect(Self.contrast(Self.luminance(color), onBrand) >= 4.5)
      }

      /// The focused sidebar selection, alert default buttons and checkboxes all draw white on the accent.
      @Test(arguments: [false, true])
      func accentColorCarriesWhite(dark: Bool) throws {
        #expect(try Self.contrast(Self.luminance(Self.resolved("AccentColor", dark: dark)), 1) >= 4.5)
      }

      /// Native `.borderedProminent` paints its label white unless the style is set inside the label.
      @Test(arguments: [false, true])
      func primaryButtonLabelIsDark(dark: Bool) throws {
        let host = NSHostingView(rootView: Button("HHHHHHHH") {}.buttonStyle(.brandPrimary).environment(\.controlActiveState, .key))
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 200, height: 60), styleMask: [.titled], backing: .buffered, defer: false)
        window.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        window.contentView = host
        window.setContentSize(host.fittingSize)
        window.orderFront(nil)
        defer { window.orderOut(nil) }
        host.layoutSubtreeIfNeeded()
        let bitmap = try #require(host.bitmapImageRepForCachingDisplay(in: host.bounds))
        host.cacheDisplay(in: host.bounds, to: bitmap)
        var darkPixels = 0, whitePixels = 0
        for row in bitmap.pixelsHigh / 3 ..< bitmap.pixelsHigh * 2 / 3 {
          for column in bitmap.pixelsWide / 5 ..< bitmap.pixelsWide * 4 / 5 {
            guard let color = bitmap.colorAt(x: column, y: row)?.usingColorSpace(.sRGB) else { continue }
            let channels = [color.redComponent, color.greenComponent, color.blueComponent]
            if channels.allSatisfy({ $0 < 0.2 }) { darkPixels += 1 }
            if channels.allSatisfy({ $0 > 0.9 }) { whitePixels += 1 }
          }
        }
        #expect(darkPixels > 20, "The label is dark (\(darkPixels) pixels).")
        #expect(whitePixels == 0, "Nothing inside the button is white (\(whitePixels) pixels).")
      }
    }
  }
#endif

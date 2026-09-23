#if os(macOS)
  import AppKit
  @testable import Sokosumi
  import SokosumiChat
  import Testing

  /// Every format button shows a real SF Symbol, and inline code and the code block read as different icons,
  /// as web's lucide `Code` and `SquareCode` do.
  struct ComposerFormatToolbarTests {
    @Test(arguments: ComposerInlineText.Style.allCases)
    func inlineStyleSymbolResolves(_ style: ComposerInlineText.Style) {
      #expect(NSImage(systemSymbolName: ComposerFormatToolbar.symbol(style), accessibilityDescription: nil) != nil)
    }

    @Test(arguments: ComposerBlockFormat.allCases)
    func blockFormatSymbolResolves(_ format: ComposerBlockFormat) {
      #expect(NSImage(systemSymbolName: ComposerFormatToolbar.symbol(format), accessibilityDescription: nil) != nil)
    }

    /// Compares drawn pixels, not names: a legacy name such as `chevron.left.slash.chevron.right` is an alias
    /// that draws the same glyph as `chevron.left.forwardslash.chevron.right`.
    @Test func inlineCodeAndCodeBlockDrawDifferentGlyphs() throws {
      let inline = try pixels(ComposerFormatToolbar.symbol(ComposerInlineText.Style.code))
      let block = try pixels(ComposerFormatToolbar.symbol(ComposerBlockFormat.codeBlock))
      #expect(inline != block)
    }

    private func pixels(_ symbol: String) throws -> Data {
      let image = try #require(NSImage(systemSymbolName: symbol, accessibilityDescription: nil))
      let rep = try #require(NSBitmapImageRep(
        bitmapDataPlanes: nil, pixelsWide: 32, pixelsHigh: 32, bitsPerSample: 8, samplesPerPixel: 4,
        hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0
      ))
      NSGraphicsContext.saveGraphicsState()
      defer { NSGraphicsContext.restoreGraphicsState() }
      NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
      image.draw(in: NSRect(x: 0, y: 0, width: 32, height: 32))
      let bytes = try #require(rep.bitmapData)
      return Data(bytes: bytes, count: rep.bytesPerRow * rep.pixelsHigh)
    }
  }
#endif

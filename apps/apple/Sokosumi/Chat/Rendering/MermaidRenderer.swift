import AppKit
import BeautifulMermaid
import SokosumiChat

/// Draws accepted Mermaid flowcharts with BeautifulMermaid (row 10d), off the main thread and one at a time:
/// the layout engine keeps shared static state, as web's Mermaid keeps global state (`render-mermaid.ts`).
actor MermaidRenderer {
  static let shared = MermaidRenderer()

  /// The app's semantic colours for one appearance, mapped as web maps its tokens: the figure's background behind
  /// the diagram and its edge labels, the label colour for text, lines and borders, and a muted fill for nodes.
  struct Palette: Hashable {
    let background: CGColor
    let foreground: CGColor
    let fill: CGColor

    init(dark: Bool) {
      var background = CGColor.white
      var foreground = CGColor.black
      NSAppearance(named: dark ? .darkAqua : .aqua)?.performAsCurrentDrawingAppearance {
        background = (NSColor.controlBackgroundColor.usingColorSpace(.sRGB) ?? .windowBackgroundColor).cgColor
        foreground = (NSColor.labelColor.usingColorSpace(.sRGB) ?? .black).cgColor
      }
      self.background = background
      self.foreground = foreground
      fill = NSColor(cgColor: background)?.blended(withFraction: 0.08, of: NSColor(cgColor: foreground) ?? .black)?.cgColor ?? background
    }
  }

  struct Output: Sendable {
    let image: CGImage
    /// Pixels per point; below the display's for a diagram too large to draw at full resolution.
    let scale: CGFloat
    /// The diagram's own size in points.
    let size: CGSize
  }

  enum Failure: Error {
    case refused, empty
  }

  /// The largest bitmap a diagram may take: 16,384 pixels a side and 16 megapixels (64 MB) in all.
  static let maxPixelDimension: CGFloat = 16384
  static let maxPixelArea: CGFloat = 16_777_216

  /// The display's scale, lowered so the bitmap stays within both caps.
  static func scale(for size: CGSize, displayScale: CGFloat) -> CGFloat {
    guard size.width > 0, size.height > 0 else { return displayScale }
    return min(
      displayScale,
      maxPixelDimension / max(size.width, size.height),
      (maxPixelArea / (size.width * size.height)).squareRoot()
    )
  }

  /// Only a complete diagram web's policy accepts reaches the package; anything else is refused here too.
  func render(_ diagram: SokosumiChat.MermaidDiagram, palette: Palette, displayScale: CGFloat) throws -> Output {
    guard diagram.complete, diagram.refusal == nil else { throw Failure.refused }
    let theme = DiagramTheme(
      background: NSColor(cgColor: palette.background) ?? .white,
      foreground: NSColor(cgColor: palette.foreground) ?? .black,
      line: NSColor(cgColor: palette.foreground),
      surface: NSColor(cgColor: palette.fill),
      border: NSColor(cgColor: palette.foreground),
      font: .systemFont(ofSize: NSFont.systemFontSize)
    )
    guard let prepared = try MermaidImageRenderer(theme: theme).prepare(from: diagram.source) else { throw Failure.empty }
    let bounds = prepared.bounds
    let scale = Self.scale(for: bounds.size, displayScale: displayScale)
    let width = Int((bounds.width * scale).rounded(.up))
    let height = Int((bounds.height * scale).rounded(.up))
    guard width > 0, height > 0, let space = CGColorSpace(name: CGColorSpace.sRGB),
          let context = CGContext(
            data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0, space: space,
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
          )
    else { throw Failure.empty }
    context.setFillColor(palette.background)
    context.fill(CGRect(x: 0, y: 0, width: width, height: height))
    // The package draws top-down; its own AppKit image path skips this flip and draws upside down.
    context.translateBy(x: 0, y: CGFloat(height))
    context.scaleBy(x: scale, y: -scale)
    context.translateBy(x: -bounds.minX, y: -bounds.minY)
    prepared.render(context, bounds)
    guard let image = context.makeImage() else { throw Failure.empty }
    return Output(image: image, scale: scale, size: bounds.size)
  }
}

import SokosumiChat
import SwiftUI

/// Share the web's remembered-proportions behavior without retaining decoded row images.
struct MessageImageView: View {
  let url: URL
  let maxSize: CGSize
  /// Fill the width budget and crop the overflow, so a card's image edge lines up with its text at any aspect ratio.
  var fills = false
  /// A thumbnail crops to this shape instead of keeping the source proportions.
  var cropAspectRatio: CGFloat?
  var cornerRadius: CGFloat = 0
  /// Where a fitted image sits in its width budget: leading in a message, centered in the viewer.
  var alignment: Alignment = .leading
  var onFailure: ((URL) -> Void)?

  @Environment(\.displayScale) private var displayScale
  @State private var loaded: Result?

  private struct Result {
    let url: URL
    let image: Image?
    let ratio: CGFloat?
  }

  private static let proportions: NSCache<NSURL, NSNumber> = {
    let cache = NSCache<NSURL, NSNumber>()
    cache.countLimit = 512
    return cache
  }()

  private var ratio: CGFloat? {
    if loaded?.url == url, let ratio = loaded?.ratio {
      return ratio
    }
    return Self.proportions.object(forKey: url as NSURL).map { CGFloat($0.doubleValue) }
  }

  /// Anything taller than the budget lays out as the budget itself; `scaledToFill` then crops what does not fit.
  private var layoutRatio: CGFloat? {
    if let cropAspectRatio {
      return cropAspectRatio
    }
    guard let ratio else { return nil }
    guard fills, maxSize.width > 0, maxSize.height > 0 else { return ratio }
    return max(ratio, maxSize.width / maxSize.height)
  }

  var body: some View {
    Group {
      if let loaded, loaded.url == url, loaded.image == nil {
        Label("Preview unavailable", systemImage: "photo")
      } else if let layoutRatio {
        Color.clear.aspectRatio(layoutRatio, contentMode: .fit)
      } else {
        // The API has no dimensions. Reserve the image's height budget on its first load.
        Color.clear.frame(idealHeight: maxSize.height, maxHeight: maxSize.height)
      }
    }
    .overlay {
      if let loaded, loaded.url == url {
        if let image = loaded.image {
          if fills {
            image.resizable().scaledToFill().clipped()
          } else {
            image.resizable().scaledToFit()
          }
        }
      } else {
        ProgressView()
      }
    }
    .clipShape(.rect(cornerRadius: cornerRadius))
    // Filling wants the whole width budget, so say so: `Color.clear` contributes no ideal width of its own.
    .frame(idealWidth: fills ? maxSize.width : nil, maxWidth: maxSize.width, maxHeight: maxSize.height, alignment: alignment)
    .task(id: "\(url)-\(maxSize)-\(displayScale)") {
      let result = await loadImageThumbnail(
        urlString: url.absoluteString,
        pointSize: max(maxSize.width, maxSize.height),
        scale: displayScale
      )
      guard !Task.isCancelled else { return }
      let decoded = result.flatMap(Self.displayImage)
      if let decoded {
        Self.proportions.setObject(NSNumber(value: Double(decoded.ratio)), forKey: url as NSURL)
      }
      loaded = Result(url: url, image: decoded?.image, ratio: decoded?.ratio)
      if decoded == nil {
        onFailure?(url)
      }
    }
  }

  private static func displayImage(_ result: LoadedImage) -> (image: Image, ratio: CGFloat)? {
    switch result {
    case let .thumbnail(image):
      return (Image(decorative: image, scale: 1), CGFloat(image.width) / CGFloat(image.height))
    case let .source(data):
      // Let the native view handle formats ImageIO could not decode, including SVG.
      #if os(macOS)
        guard let image = NSImage(data: data), image.size.width > 0, image.size.height > 0 else { return nil }
        return (Image(nsImage: image), image.size.width / image.size.height)
      #else
        guard let image = UIImage(data: data), image.size.width > 0, image.size.height > 0 else { return nil }
        return (Image(uiImage: image), image.size.width / image.size.height)
      #endif
    }
  }
}

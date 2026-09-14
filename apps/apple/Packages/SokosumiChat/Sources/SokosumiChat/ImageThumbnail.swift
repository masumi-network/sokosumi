import Foundation
import ImageIO

/// Decode a display-sized thumbnail for avatars and attachment previews.
public func loadThumbnailCGImage(
  urlString: String?,
  pointSize: CGFloat,
  scale: CGFloat
) async -> CGImage? {
  guard let urlString, let url = URL(string: urlString) else { return nil }
  let data: Data
  let response: URLResponse
  do {
    (data, response) = try await URLSession.shared.data(from: url)
  } catch is CancellationError {
    return nil
  } catch {
    return nil
  }
  guard !Task.isCancelled else { return nil }
  if let http = response as? HTTPURLResponse, !(200 ..< 300).contains(http.statusCode) {
    return nil
  }
  return await decodeImageThumbnail(data: data, maxPixel: max(pointSize * scale, 1))
}

/// ImageIO can synchronously wait on its own decoder threads. Keep that work
/// off the caller's cooperative executor and do not inherit a view task's QoS.
private let imageDecodeQueue = DispatchQueue(label: "com.sokosumi.image-decode", qos: .utility)

func decodeImageThumbnail(data: Data, maxPixel: CGFloat) async -> CGImage? {
  guard !Task.isCancelled else { return nil }
  let image: CGImage? = await withCheckedContinuation { continuation in
    imageDecodeQueue.async(qos: .utility, flags: .enforceQoS) {
      continuation.resume(returning: imageThumbnail(data: data, maxPixel: maxPixel))
    }
  }
  return Task.isCancelled ? nil : image
}

private func imageThumbnail(data: Data, maxPixel: CGFloat) -> CGImage? {
  dispatchPrecondition(condition: .onQueue(imageDecodeQueue))
  let sourceOptions: [CFString: Any] = [kCGImageSourceShouldCache: false]
  guard let source = CGImageSourceCreateWithData(data as CFData, sourceOptions as CFDictionary) else {
    return nil
  }
  let options: [CFString: Any] = [
    kCGImageSourceCreateThumbnailFromImageAlways: true,
    kCGImageSourceCreateThumbnailWithTransform: true,
    kCGImageSourceThumbnailMaxPixelSize: maxPixel,
    kCGImageSourceShouldCacheImmediately: true
  ]
  return CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary)
}

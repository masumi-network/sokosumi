import Foundation
import ImageIO

/// Decode a thumbnail at `pointSize * scale` pixels so 20pt faces stay
/// sharp on Retina. `AsyncImage` tags the bitmap as 1x and looks soft.
public func loadAvatarCGImage(
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
  return avatarThumbnail(data: data, maxPixel: max(pointSize * scale, 1))
}

private func avatarThumbnail(data: Data, maxPixel: CGFloat) -> CGImage? {
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

public func avatarInitials(from name: String) -> String {
  let words = name.split(separator: " ")
  let first = words.first?.first.map(String.init) ?? ""
  let second = words.dropFirst().first?.first.map(String.init) ?? ""
  let result = (first + second).uppercased()
  return result.isEmpty ? "?" : result
}

import Foundation

/// An image viewer's image as the server sent it, for Copy Image and Print.
public struct FetchedImage: Equatable, Sendable {
  public let data: Data
  /// The declared MIME type, as web's `blob.type`, else `image/png`.
  public let contentType: String

  public init(data: Data, contentType: String) {
    self.data = data
    self.contentType = contentType
  }
}

/// The fetch behind web's `copyImageToClipboard` (`image-viewer.tsx`): the image's bytes typed
/// `blob.type || "image/png"`. Copy falls back to the image's URL when this returns nil; Print
/// reports that it could not print.
public enum ImageFetch {
  /// Nil on a transport error, an error status, an empty body or a URL that is not http(s).
  /// No Core credentials are forwarded to message-authored URLs.
  public static func image(at url: URL, session: URLSession = .shared) async -> FetchedImage? {
    guard ["http", "https"].contains(url.scheme?.lowercased() ?? ""), url.host != nil,
          let (data, response) = try? await session.data(from: url),
          let http = response as? HTTPURLResponse, (200 ..< 300).contains(http.statusCode), !data.isEmpty else {
      return nil
    }
    // The declared type, as web's `blob.type`; URLSession's `mimeType` is sniffed from the bytes.
    let declared = http.value(forHTTPHeaderField: "Content-Type")?
      .split(separator: ";").first?.trimmingCharacters(in: .whitespaces).lowercased()
    return FetchedImage(data: data, contentType: declared.flatMap { $0.isEmpty ? nil : $0 } ?? "image/png")
  }
}

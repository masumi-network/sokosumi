import Foundation

/// What the image viewer's Copy image puts on the clipboard.
public enum ImageCopyContent: Equatable, Sendable {
  /// The image's bytes with the MIME type the server named.
  case image(Data, contentType: String)
  /// The image's address, web's fallback when the bytes cannot be copied.
  case link(URL)
}

/// Web's `copyImageToClipboard` (`image-viewer.tsx`): fetch the image and copy its bytes, typed
/// `image/png` when the server names none; when that fails, copy the image's URL instead.
public enum ImageCopy {
  /// No Core credentials are forwarded to message-authored URLs.
  public static func content(of url: URL, session: URLSession = .shared) async -> ImageCopyContent {
    guard ["http", "https"].contains(url.scheme?.lowercased() ?? ""), url.host != nil,
          let (data, response) = try? await session.data(from: url),
          let http = response as? HTTPURLResponse, (200 ..< 300).contains(http.statusCode), !data.isEmpty else {
      return .link(url)
    }
    // The declared type, as web's `blob.type`; URLSession's `mimeType` is sniffed from the bytes.
    let declared = http.value(forHTTPHeaderField: "Content-Type")?
      .split(separator: ";").first?.trimmingCharacters(in: .whitespaces).lowercased()
    return .image(data, contentType: declared.flatMap { $0.isEmpty ? nil : $0 } ?? "image/png")
  }
}

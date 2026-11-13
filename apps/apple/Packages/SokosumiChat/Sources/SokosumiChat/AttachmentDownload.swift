import Foundation

public enum AttachmentDownload {
  public enum Failure: LocalizedError {
    case invalidResponse
    /// Over the caller's byte cap, whether the server announced the length or not.
    case tooLarge
    public var errorDescription: String? {
      switch self {
      case .invalidResponse: "The file could not be downloaded. Try again or open the original link."
      case .tooLarge: "The file is too large to preview. Open the original link."
      }
    }
  }

  /// Matches the web text viewer's UTF-8 decoding, including replacement of invalid bytes.
  public static func text(_ url: URL, session: URLSession = .shared) async throws -> String {
    let file = try await fetch(url, session: session)
    defer { try? FileManager.default.removeItem(at: file) }
    let data = try Data(contentsOf: file)
    try Task.checkCancellation()
    // Fetch text decoding replaces invalid UTF-8 instead of failing.
    // swiftlint:disable:next optional_data_string_conversion
    let text = String(decoding: data, as: UTF8.self)
    return text.hasPrefix("\u{FEFF}") ? String(text.dropFirst()) : text
  }

  /// Streams at most `maxBytes` into a temporary file and stops at the first byte over, so a server that sends no
  /// length, or a wrong one, cannot make the app read more.
  public static func fetch(_ url: URL, maxBytes: Int, session: URLSession = .shared) async throws -> URL {
    guard ["http", "https"].contains(url.scheme?.lowercased() ?? ""), url.host != nil else { throw Failure.invalidResponse }
    let (bytes, response) = try await session.bytes(from: url)
    guard let http = response as? HTTPURLResponse, (200 ..< 300).contains(http.statusCode) else { throw Failure.invalidResponse }
    guard response.expectedContentLength <= maxBytes else { throw Failure.tooLarge }
    var data = Data()
    for try await byte in bytes {
      guard data.count < maxBytes else { throw Failure.tooLarge }
      data.append(byte)
    }
    try Task.checkCancellation()
    let destination = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try data.write(to: destination)
    return destination
  }

  /// No Core credentials are forwarded to message-authored URLs.
  public static func fetch(_ url: URL, session: URLSession = .shared) async throws -> URL {
    guard ["http", "https"].contains(url.scheme?.lowercased() ?? ""), url.host != nil else { throw Failure.invalidResponse }
    let (temporary, response) = try await session.download(from: url)
    defer { try? FileManager.default.removeItem(at: temporary) }
    guard let http = response as? HTTPURLResponse, (200 ..< 300).contains(http.statusCode) else { throw Failure.invalidResponse }
    try Task.checkCancellation()
    let destination = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.moveItem(at: temporary, to: destination)
    return destination
  }
}

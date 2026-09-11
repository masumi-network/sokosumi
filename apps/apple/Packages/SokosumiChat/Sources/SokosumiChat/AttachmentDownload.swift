import Foundation

public enum AttachmentDownload {
  public enum Failure: LocalizedError {
    case invalidResponse
    public var errorDescription: String? {
      "The file could not be downloaded. Try again or open the original link."
    }
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

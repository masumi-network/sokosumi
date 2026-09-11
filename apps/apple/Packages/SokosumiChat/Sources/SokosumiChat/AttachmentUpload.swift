import CoreAPI
import Foundation

public enum AttachmentUpload {
  public static let maximumSize = 100 * 1024 * 1024

  public enum Failure: LocalizedError {
    case invalidFile, tooLarge, unsupportedType, invalidResponse

    public var errorDescription: String? {
      switch self {
      case .invalidFile: "Choose a nonempty regular file."
      case .tooLarge: "Files must be 100 MiB or smaller."
      case .unsupportedType: "This file type is not supported."
      case .invalidResponse: "The upload did not return a valid file URL. Try again."
      }
    }
  }

  /// Core's user-upload-content-type allowlist, including its filename aliases.
  private static let contentTypes: [String: String] = [
    "csv": "text/csv",
    "doc": "application/msword",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "gif": "image/gif",
    "gz": "application/gzip",
    "heic": "image/heic",
    "heif": "image/heic",
    "jpe": "image/jpeg",
    "jpeg": "image/jpeg",
    "jpg": "image/jpeg",
    "json": "application/json",
    "m4a": "audio/m4a",
    "markdown": "text/markdown",
    "md": "text/markdown",
    "mov": "video/quicktime",
    "mp3": "audio/mpeg",
    "mp4": "video/mp4",
    "mpga": "audio/mpeg",
    "mpeg": "audio/mpeg",
    "pdf": "application/pdf",
    "png": "image/png",
    "ppt": "application/vnd.ms-powerpoint",
    "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "qt": "video/quicktime",
    "svg": "image/svg+xml",
    "tar": "application/x-tar",
    "txt": "text/plain",
    "wav": "audio/wav",
    "weba": "audio/webm",
    "webm": "video/webm",
    "webp": "image/webp",
    "xls": "application/vnd.ms-excel",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "zip": "application/zip"
  ]

  public static func contentType(filename: String) throws -> String {
    guard let type = contentTypes[(filename as NSString).pathExtension.lowercased()] else { throw Failure.unsupportedType }
    return type
  }

  public static func validate(size: Int) throws {
    guard size > 0 else { throw Failure.invalidFile }
    guard size <= maximumSize else { throw Failure.tooLarge }
  }

  public static func request(grant: Components.Schemas.ChatRoomFileUploadSession, size: Int) throws -> URLRequest {
    try validate(size: size)
    guard size <= grant.maxSizeBytes, grant.expiresAt > Date(),
          let url = URL(string: grant.uploadUrl), url.scheme == "https", url.host != nil else { throw Failure.invalidResponse }
    var request = URLRequest(url: url)
    request.httpMethod = "PUT"
    request.setValue(grant.headers.contentType, forHTTPHeaderField: "Content-Type")
    return request
  }

  public static func put(file: URL, filename: String, contentType: String, size: Int, grant: Components.Schemas.ChatRoomFileUploadSession, session: URLSession = .shared) async throws -> ComposeAttachment {
    let request = try request(grant: grant, size: size)
    let (data, response) = try await session.upload(for: request, fromFile: file)
    guard let http = response as? HTTPURLResponse, (200 ..< 300).contains(http.statusCode) else { throw Failure.invalidResponse }
    struct Response: Decodable { let url: String }
    guard let result = try? JSONDecoder().decode(Response.self, from: data) else { throw Failure.invalidResponse }
    guard let url = URL(string: result.url), url.scheme == "https", url.host != nil else { throw Failure.invalidResponse }
    return ComposeAttachment(url: result.url, fileName: filename, mediaType: contentType)
  }
}

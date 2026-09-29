import Foundation
import SokosumiChat
import Testing

/// Serves fixed image bytes by path; fails any request carrying credentials.
private class ImageFetchProtocol: URLProtocol, @unchecked Sendable {
  static let bytes = Data([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x01])

  override class func canInit(with _: URLRequest) -> Bool {
    true
  }

  override class func canonicalRequest(for request: URLRequest) -> URLRequest {
    request
  }

  override func startLoading() {
    guard let url = request.url else { return }
    if url.path == "/offline" || request.value(forHTTPHeaderField: "Authorization") != nil {
      client?.urlProtocol(self, didFailWithError: URLError(.notConnectedToInternet))
      return
    }
    let status = url.path == "/missing" ? 404 : 200
    let headers: [String: String] = switch url.path {
    case "/photo.jpg": ["Content-Type": "image/jpeg; charset=binary"]
    case "/untyped": [:]
    default: ["Content-Type": "image/png"]
    }
    guard let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: headers) else { return }
    client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
    client?.urlProtocol(self, didLoad: url.path == "/empty" ? Data() : Self.bytes)
    client?.urlProtocolDidFinishLoading(self)
  }

  override func stopLoading() {}
}

/// Rows 15a2a/15a2b: the image fetch behind web's Copy image (`copyImageToClipboard`,
/// image-viewer.tsx), which Apple's Print shares: the bytes, typed `image/png` when the server
/// names no type, or nil when they cannot be fetched. Fixed URLs.
struct ImageFetchTests {
  private static func session() -> URLSession {
    let config = URLSessionConfiguration.ephemeral
    config.protocolClasses = [ImageFetchProtocol.self]
    return URLSession(configuration: config)
  }

  private static func url(_ path: String) -> URL {
    URL(string: "https://cdn.example\(path)")!
  }

  @Test func fetchesTheBytesWithTheirType() async {
    let session = Self.session()
    defer { session.invalidateAndCancel() }
    let png = await ImageFetch.image(at: Self.url("/chart.png"), session: session)
    #expect(png == FetchedImage(data: ImageFetchProtocol.bytes, contentType: "image/png"))
    let jpeg = await ImageFetch.image(at: Self.url("/photo.jpg"), session: session)
    #expect(jpeg == FetchedImage(data: ImageFetchProtocol.bytes, contentType: "image/jpeg"))
  }

  /// Web: `blob.type || "image/png"`. The bytes are a PNG either way, so the declared type is what counts,
  /// not what URLSession sniffs from them.
  @Test func anUntypedImageIsAPNG() async {
    let session = Self.session()
    defer { session.invalidateAndCancel() }
    let untyped = await ImageFetch.image(at: Self.url("/untyped"), session: session)
    #expect(untyped == FetchedImage(data: ImageFetchProtocol.bytes, contentType: "image/png"))
  }

  /// Web copies the URL when the image cannot be fetched; Apple also counts an error status or an
  /// empty body as a failed fetch, and never sends credentials or reads a local file.
  @Test func nothingWhenTheImageCannotBeFetched() async {
    let session = Self.session()
    defer { session.invalidateAndCancel() }
    for path in ["/missing", "/offline", "/empty"] {
      #expect(await ImageFetch.image(at: Self.url(path), session: session) == nil, "\(path)")
    }
    #expect(await ImageFetch.image(at: URL(fileURLWithPath: "/tmp/private.png"), session: session) == nil)
  }
}

import Foundation
import SokosumiChat
import Testing

/// Serves fixed image bytes by path; fails any request carrying credentials.
private class ImageCopyProtocol: URLProtocol, @unchecked Sendable {
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

/// Row 15a2a: web's Copy image (`copyImageToClipboard`, image-viewer.tsx): the fetched bytes, typed
/// `image/png` when the server names no type, else the image's URL. Fixed URLs.
struct ImageCopyTests {
  private static func session() -> URLSession {
    let config = URLSessionConfiguration.ephemeral
    config.protocolClasses = [ImageCopyProtocol.self]
    return URLSession(configuration: config)
  }

  private static func url(_ path: String) -> URL {
    URL(string: "https://cdn.example\(path)")!
  }

  @Test func copiesTheFetchedBytesWithTheirType() async {
    let session = Self.session()
    defer { session.invalidateAndCancel() }
    let png = await ImageCopy.content(of: Self.url("/chart.png"), session: session)
    #expect(png == .image(ImageCopyProtocol.bytes, contentType: "image/png"))
    let jpeg = await ImageCopy.content(of: Self.url("/photo.jpg"), session: session)
    #expect(jpeg == .image(ImageCopyProtocol.bytes, contentType: "image/jpeg"))
  }

  /// Web: `blob.type || "image/png"`. The bytes are a PNG either way, so the declared type is what counts,
  /// not what URLSession sniffs from them.
  @Test func anUntypedImageIsCopiedAsPNG() async {
    let session = Self.session()
    defer { session.invalidateAndCancel() }
    let untyped = await ImageCopy.content(of: Self.url("/untyped"), session: session)
    #expect(untyped == .image(ImageCopyProtocol.bytes, contentType: "image/png"))
  }

  /// Web falls back to copying the URL when the image cannot be copied; Apple also counts an error
  /// status or an empty body as a failed fetch, and never sends credentials or reads a local file.
  @Test func fallsBackToTheLinkWhenTheImageCannotBeFetched() async {
    let session = Self.session()
    defer { session.invalidateAndCancel() }
    for path in ["/missing", "/offline", "/empty"] {
      #expect(await ImageCopy.content(of: Self.url(path), session: session) == .link(Self.url(path)), "\(path)")
    }
    let local = URL(fileURLWithPath: "/tmp/private.png")
    #expect(await ImageCopy.content(of: local, session: session) == .link(local))
  }
}

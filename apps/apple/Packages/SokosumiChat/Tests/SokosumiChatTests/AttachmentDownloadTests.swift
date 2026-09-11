import Foundation
import SokosumiChat
import Testing

private class AttachmentDownloadProtocol: URLProtocol, @unchecked Sendable {
  override class func canInit(with _: URLRequest) -> Bool {
    true
  }

  override class func canonicalRequest(for request: URLRequest) -> URLRequest {
    request
  }

  override func startLoading() {
    guard let url = request.url else { return }
    let status = url.path == "/missing" ? 404 : 200
    guard let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: nil) else { return }
    client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
    let body = request.value(forHTTPHeaderField: "Authorization") == nil ? "file contents" : "unexpected credentials"
    client?.urlProtocol(self, didLoad: Data(body.utf8))
    client?.urlProtocolDidFinishLoading(self)
  }

  override func stopLoading() {}
}

@Test func attachmentDownloadKeepsFileForExportAndRejectsErrors() async throws {
  let config = URLSessionConfiguration.ephemeral
  config.protocolClasses = [AttachmentDownloadProtocol.self]
  let session = URLSession(configuration: config)
  defer { session.invalidateAndCancel() }
  let local = try await AttachmentDownload.fetch(#require(URL(string: "https://example.com/file")), session: session)
  defer { try? FileManager.default.removeItem(at: local) }
  #expect(try String(contentsOf: local, encoding: .utf8) == "file contents")
  for remote in ["https://example.com/missing", "file:///tmp/private.txt"] {
    await #expect(throws: AttachmentDownload.Failure.self) {
      try await AttachmentDownload.fetch(#require(URL(string: remote)), session: session)
    }
  }
}

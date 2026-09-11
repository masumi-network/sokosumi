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
    let bytes = switch url.path {
    case "/unicode": Data("\u{FEFF}# Grüezi 😀\n\n**Bold**".utf8)
    case "/empty": Data()
    case "/invalid": Data([0x61, 0xFF, 0x62])
    default: Data(body.utf8)
    }
    client?.urlProtocol(self, didLoad: bytes)
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

@Test func attachmentTextDownloadMatchesWebDecodingAndErrors() async throws {
  let config = URLSessionConfiguration.ephemeral
  config.protocolClasses = [AttachmentDownloadProtocol.self]
  let session = URLSession(configuration: config)
  defer { session.invalidateAndCancel() }
  for (path, expected) in [("unicode", "# Grüezi 😀\n\n**Bold**"), ("empty", ""), ("invalid", "a�b"), ("file", "file contents")] {
    let text = try await AttachmentDownload.text(#require(URL(string: "https://example.com/\(path)")), session: session)
    #expect(text == expected)
  }
  await #expect(throws: AttachmentDownload.Failure.self) {
    try await AttachmentDownload.text(#require(URL(string: "https://example.com/missing")), session: session)
  }
}

@Test func officePreviewFileKeepsExtensionAndCleansUpOnRelease() async throws {
  let config = URLSessionConfiguration.ephemeral
  config.protocolClasses = [AttachmentDownloadProtocol.self]
  let session = URLSession(configuration: config)
  defer { session.invalidateAndCancel() }
  let url = try #require(URL(string: "https://example.com/deliverables/id"))
  let attachment = try #require(MessageAttachment(url: url, label: "report.docx"))
  var file: AttachmentPreviewFile? = try await AttachmentPreviewFile.load(attachment, session: session)
  let localURL = try #require(file?.url)
  #expect(localURL.pathExtension == "docx")
  #expect(try String(contentsOf: localURL, encoding: .utf8) == "file contents")
  file = nil
  #expect(!FileManager.default.fileExists(atPath: localURL.path))
  let unsupported = try #require(MessageAttachment(url: url, label: "archive.zip"))
  await #expect(throws: AttachmentDownload.Failure.self) {
    try await AttachmentPreviewFile.load(unsupported, session: session)
  }
  let missingURL = try #require(URL(string: "https://example.com/missing"))
  let missing = try #require(MessageAttachment(url: missingURL, label: "report.docx", kindHint: .file))
  await #expect(throws: AttachmentDownload.Failure.self) {
    try await AttachmentPreviewFile.load(missing, session: session)
  }
}

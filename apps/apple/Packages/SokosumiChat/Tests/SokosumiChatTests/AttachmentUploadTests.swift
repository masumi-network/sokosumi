import CoreAPI
import Foundation
import SokosumiChat
import Testing

@Test func attachmentValidationMatchesCoreLimitsAndAliases() throws {
  try AttachmentUpload.validate(size: 100 * 1024 * 1024)
  #expect(throws: AttachmentUpload.Failure.self) { try AttachmentUpload.validate(size: 0) }
  #expect(throws: AttachmentUpload.Failure.self) { try AttachmentUpload.validate(size: 100 * 1024 * 1024 + 1) }
  #expect(try AttachmentUpload.contentType(filename: "Report.PDF") == "application/pdf")
  #expect(try AttachmentUpload.contentType(filename: "voice.m4a") == "audio/m4a")
  #expect(try AttachmentUpload.contentType(filename: "message.md") == "text/markdown")
  #expect(throws: AttachmentUpload.Failure.self) { try AttachmentUpload.contentType(filename: "binary.exe") }
}

@Test func attachmentRequestUsesOnlyGrantCredentials() throws {
  let grant = Components.Schemas.ChatRoomFileUploadSession(
    uploadUrl: "https://blob.example/file?signature=secret", pathname: "file", access: ._public, method: .put,
    headers: .init(contentType: "image/png"), expiresAt: Date().addingTimeInterval(60), maxSizeBytes: 100, addRandomSuffix: true
  )
  let request = try AttachmentUpload.request(grant: grant, size: 10)
  #expect(request.httpMethod == "PUT")
  #expect(request.allHTTPHeaderFields == ["Content-Type": "image/png"])
  #expect(request.url?.query == "signature=secret")
  #expect(throws: AttachmentUpload.Failure.self) { try AttachmentUpload.request(grant: grant, size: 101) }
  var expired = grant
  expired.expiresAt = .distantPast
  #expect(throws: AttachmentUpload.Failure.self) { try AttachmentUpload.request(grant: expired, size: 10) }
}

@Test func attachmentContentSupportsFileOnlyAndSafeLabels() {
  let attachment = ComposeAttachment(url: "https://blob.example/a(b).pdf", fileName: "[report].pdf", mediaType: "application/pdf")
  let fileOnly = ComposeAttachment.message("   ", attachments: [attachment])
  #expect(fileOnly == "[report.pdf](https://blob.example/a%28b%29.pdf)")
  #expect(ComposerContent(fileOnly).canSend)
  #expect(ComposeAttachment.message(" hello ", attachments: [attachment]) == "hello\n" + fileOnly)
  #expect(ComposeAttachment.message("hello", attachments: []) == "hello")
}

@Test @MainActor func attachmentDraftSurvivesTextEditsAndIsolatesThreads() throws {
  let name = UUID().uuidString
  let defaults = try #require(UserDefaults(suiteName: name))
  defer { defaults.removePersistentDomain(forName: name) }
  let room = SavedComposeDraft(userId: "me", organizationId: "org", roomId: "room", defaults: defaults)
  let thread = SavedComposeDraft(userId: "me", organizationId: "org", roomId: "room", parentMessageId: "parent", defaults: defaults)
  let file = ComposeAttachment(url: "https://blob.example/a", fileName: "a.txt", mediaType: "text/plain")
  room.saveAttachments([file])
  room.save("")
  #expect(room.loadAttachments() == [file])
  #expect(thread.loadAttachments().isEmpty)
  let state = ComposeUploads(savedDraft: room)
  #expect(state.attachments == [file])
  state.remove(file)
  #expect(room.loadAttachments().isEmpty)
}

@Test @MainActor func canceledAttachmentCannotEnterDraftAfterLateCompletion() async throws {
  let name = UUID().uuidString
  let defaults = try #require(UserDefaults(suiteName: name))
  defer { defaults.removePersistentDomain(forName: name) }
  let saved = SavedComposeDraft(userId: "me", organizationId: nil, roomId: "room", defaults: defaults)
  let state = ComposeUploads(savedDraft: saved)
  var resume: CheckedContinuation<ComposeAttachment, Never>?
  state.upload([URL(fileURLWithPath: "/unused.txt")]) { _ in
    await withCheckedContinuation { resume = $0 }
  }
  for _ in 0 ..< 100 where resume == nil {
    try await Task.sleep(for: .milliseconds(1))
  }
  let continuation = try #require(resume)
  state.cancel()
  continuation.resume(returning: .init(url: "https://blob.example/a", fileName: "a.txt", mediaType: "text/plain"))
  for _ in 0 ..< 10 {
    await Task.yield()
  }
  #expect(state.attachments.isEmpty)
  #expect(saved.loadAttachments().isEmpty)
  #expect(state.uploadingName == nil)
}

private class AttachmentBlobProtocol: URLProtocol, @unchecked Sendable {
  override class func canInit(with _: URLRequest) -> Bool {
    true
  }

  override class func canonicalRequest(for request: URLRequest) -> URLRequest {
    request
  }

  override func startLoading() {
    guard let url = request.url, let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: nil) else { return }
    client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
    let body = url.path == "/missing" ? "{}" : "{\"url\":\"https://blob.example/uploaded.txt\"}"
    client?.urlProtocol(self, didLoad: Data(body.utf8))
    client?.urlProtocolDidFinishLoading(self)
  }

  override func stopLoading() {}
}

@Test func blobUploadRequiresPublicURLInSuccessfulResponse() async throws {
  let file = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".txt")
  try Data("hello".utf8).write(to: file)
  defer { try? FileManager.default.removeItem(at: file) }
  let configuration = URLSessionConfiguration.ephemeral
  configuration.protocolClasses = [AttachmentBlobProtocol.self]
  let session = URLSession(configuration: configuration)
  defer { session.invalidateAndCancel() }
  var grant = Components.Schemas.ChatRoomFileUploadSession(
    uploadUrl: "https://blob.example/upload", pathname: "file", access: ._public, method: .put,
    headers: .init(contentType: "text/plain"), expiresAt: Date().addingTimeInterval(60), maxSizeBytes: 100, addRandomSuffix: true
  )
  let uploaded = try await AttachmentUpload.put(file: file, filename: "hello.txt", contentType: "text/plain", size: 5, grant: grant, session: session)
  #expect(uploaded.url == "https://blob.example/uploaded.txt")
  #expect(uploaded.fileName == "hello.txt")
  grant.uploadUrl = "https://blob.example/missing"
  await #expect(throws: (any Error).self) {
    try await AttachmentUpload.put(file: file, filename: "hello.txt", contentType: "text/plain", size: 5, grant: grant, session: session)
  }
}

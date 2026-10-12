import CoreAPI
import Foundation
import HTTPTypes
@testable import SokosumiChat
import Testing

/// Fixed ids and bodies for the protected outputs (row 38e2).
private enum OutputFixture {
  static let card = "7d1f0c2a-0000-4000-8000-000000000011"
  static let file = "8a2e0d3b-0000-4000-8000-000000000021"

  static func output(_ name: String, _ contentType: String?, preview: String?, open: String = "/api/jobs/job-1/files/blob-1/content",
                     download: String? = nil) -> String {
    let type = contentType.map { "\"\($0)\"" } ?? "null"
    let previewHref = preview.map { "\"\($0)\"" } ?? "null"
    let downloadHref = download.map { "\"\($0)\"" } ?? "null"
    return #"{"name":"\#(name)","contentType":\#(type),"sizeBytes":1024,"openHref":"\#(open)","previewHref":\#(previewHref),"downloadHref":\#(downloadHref)}"#
  }

  static func card(_ outputs: [String]) -> String {
    """
    {"id":"\(card)","state":"available","capturedAt":"2026-10-07T14:06:00.000Z","kind":"job","title":"Outputs",\
    "status":"completed","sourceHref":"/agents/ag-1/jobs/job-1","outputs":[\(outputs.joined(separator: ","))]}
    """
  }

  static func outputs(_ outputs: [String]) async throws -> [ResultPreviewCard.Output] {
    let previews = try await ResultFixture.previews([card(outputs)])
    guard case let .available(card)? = MessageResultPreviews.items(previews, descriptorIds: [Self.card], webBaseURL: ResultFixture.web).first else {
      Issue.record("no card")
      return []
    }
    return card.outputs
  }

  static let job = "/api/jobs/job-1/files/blob-1/content"
}

@MainActor struct ResultOutputsTests {
  // MARK: Core's content hrefs

  /// Core writes three content hrefs, each a web route proxying one Core operation (chat-result-preview.service.ts).
  @Test func coresThreeContentHrefsNameTheirCoreOperation() {
    #expect(ResultOutputSource(href: "/api/drive/files/\(OutputFixture.file)/content?scope=org&organizationId=org%201&download=true")
      == .driveFile(id: OutputFixture.file, scope: .organization, organizationId: "org 1", download: true))
    #expect(ResultOutputSource(href: "/api/drive/files/\(OutputFixture.file)/content?scope=me")
      == .driveFile(id: OutputFixture.file, scope: .personal, organizationId: nil, download: false))
    // Web's proxy reads a missing scope as `me`.
    #expect(ResultOutputSource(href: "/api/drive/files/\(OutputFixture.file)/content")
      == .driveFile(id: OutputFixture.file, scope: .personal, organizationId: nil, download: false))
    #expect(ResultOutputSource(href: "/api/jobs/job%201/files/blob-1/content") == .jobFile(jobId: "job 1", fileId: "blob-1", download: false))
    #expect(ResultOutputSource(href: "/api/jobs/job-1/files/blob-1/content?download=true") == .jobFile(jobId: "job-1", fileId: "blob-1", download: true))
    #expect(ResultOutputSource(href: "/api/projects/p1/image-studio/assets/a%2F1/content") == .studioAsset(projectId: "p1", assetId: "a/1"))
  }

  /// Web pages (a Drive file, the Studio) and anything not exactly one of the three shapes keep opening on web.
  @Test(arguments: [
    "/drive/files/f1?scope=me", "/studio?projectId=p1&v=a1", "/agents/ag-1/jobs/job-1", "/api/jobs/job-1/files/blob-1",
    "/api/jobs/job-1/files//content", "/api/jobs/job-1/files/blob-1/content/more", "//evil.example/api/jobs/j/files/f/content",
    "https://evil.example/api/jobs/j/files/f/content", "api/jobs/j/files/f/content", "/api/drive/files/f1/content?scope=team",
    "/api/projects/p1/image-studio/assets/a1/content/extra", "/api/chat/r/messages/m/results"
  ])
  func anyOtherHrefStaysOnWeb(href: String) {
    #expect(ResultOutputSource(href: href) == nil)
  }

  // MARK: What draws inline

  /// Web `classifyFilePreview` on `previewHref ?? openHref`, the name and the type: images, audio, video, PDF and text
  /// with a `previewHref` draw inline; Office, other files and an output without a `previewHref` are rows.
  @Test func outputsDrawInlineAsWebClassifiesThem() async throws {
    let outputs = try await OutputFixture.outputs([
      OutputFixture.output("chart", "image/png", preview: OutputFixture.job),
      OutputFixture.output("photo.JPG", nil, preview: OutputFixture.job),
      OutputFixture.output("clip", "video/mp4", preview: OutputFixture.job),
      OutputFixture.output("voice.ogg", "audio/ogg", preview: OutputFixture.job),
      OutputFixture.output("clip.ogg", nil, preview: OutputFixture.job),
      OutputFixture.output("report.pdf", "application/pdf", preview: OutputFixture.job),
      OutputFixture.output("notes.md", nil, preview: OutputFixture.job),
      OutputFixture.output("readme", "text/plain; charset=utf-8", preview: OutputFixture.job),
      OutputFixture.output("deck.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", preview: OutputFixture.job),
      OutputFixture.output("data.csv", "text/csv", preview: OutputFixture.job),
      OutputFixture.output("chart.png", "image/png", preview: nil),
      // A preview href Apple cannot load with the session stays a row that opens on web.
      OutputFixture.output("elsewhere.png", "image/png", preview: "/elsewhere/elsewhere.png")
    ])
    #expect(outputs.map(\.preview) == [.image, .image, .video, .audio, .video, .pdf, .text, .text, nil, nil, nil, nil])
  }

  /// Each href that names a content operation loads in the app; a web page stays a web link.
  @Test func eachActionKnowsWhereItsBytesLive() async throws {
    let drive = "/api/drive/files/\(OutputFixture.file)/content?scope=org&organizationId=org_1"
    let outputs = try await OutputFixture.outputs([
      OutputFixture.output("report.pdf", "application/pdf", preview: drive, open: "/drive/files/\(OutputFixture.file)?scope=org&organizationId=org_1",
                           download: drive + "&download=true"),
      OutputFixture.output("A red fox at dawn", "image/png", preview: "/api/projects/p1/image-studio/assets/a1/content", open: "/studio?projectId=p1&v=a1"),
      OutputFixture.output("data.csv", "text/csv", preview: OutputFixture.job, download: OutputFixture.job + "?download=true")
    ])
    #expect(outputs.map(\.previewSource) == [
      .driveFile(id: OutputFixture.file, scope: .organization, organizationId: "org_1", download: false),
      .studioAsset(projectId: "p1", assetId: "a1"),
      .jobFile(jobId: "job-1", fileId: "blob-1", download: false)
    ])
    #expect(outputs.map(\.openSource) == [nil, nil, .jobFile(jobId: "job-1", fileId: "blob-1", download: false)])
    #expect(outputs.map(\.downloadSource) == [
      .driveFile(id: OutputFixture.file, scope: .organization, organizationId: "org_1", download: true), nil,
      .jobFile(jobId: "job-1", fileId: "blob-1", download: true)
    ])
    // The web links stay for whatever Apple cannot load itself.
    #expect(outputs[0].openURL == URL(string: "https://app.example/base/drive/files/\(OutputFixture.file)?scope=org&organizationId=org_1"))
    #expect(outputs.map(\.fileName) == ["report.pdf", "A red fox at dawn.png", "data.csv"])
  }

  /// The saved or previewed file keeps the output's name and gains its type's extension when the name has none.
  @Test func theLocalFileNameKeepsTheNameAndItsType() {
    #expect(ResultPreviewCard.Output.fileName(name: "report.pdf", contentType: "application/pdf") == "report.pdf")
    #expect(ResultPreviewCard.Output.fileName(name: "A red fox at dawn", contentType: "image/png") == "A red fox at dawn.png")
    #expect(ResultPreviewCard.Output.fileName(name: "v1.2 summary", contentType: "text/plain; charset=utf-8") == "v1.2 summary.txt")
    #expect(ResultPreviewCard.Output.fileName(name: "notes", contentType: nil) == "notes")
    #expect(ResultPreviewCard.Output.fileName(name: "a/b: c", contentType: "image/jpeg") == "a-b- c.jpeg")
    #expect(ResultPreviewCard.Output.fileName(name: " .hidden ", contentType: nil) == "hidden")
    #expect(ResultPreviewCard.Output.fileName(name: "  ", contentType: "application/pdf") == "Output.pdf")
    #expect(ResultPreviewCard.Output.fileName(name: String(repeating: "x", count: 500), contentType: "image/png").count == 204)
  }

  /// A name whose own extension is a declared type of the same kind as the content type keeps it (`video/ogg` is
  /// `org.xiph.ogv`, `.ogg` is `org.xiph.ogg-audio`: both media, neither conforms to the other). A prompt or a name
  /// whose extension is another kind still gains the type's extension.
  @Test func aNameKeepsItsOwnExtensionOfTheSameKind() {
    #expect(ResultPreviewCard.Output.fileName(name: "clip.ogg", contentType: "video/ogg") == "clip.ogg")
    #expect(ResultPreviewCard.Output.fileName(name: "photo.jpg", contentType: "image/png") == "photo.jpg")
    #expect(ResultPreviewCard.Output.fileName(name: "notes.txt", contentType: "text/markdown") == "notes.txt")
    #expect(ResultPreviewCard.Output.fileName(name: "Golden hour. Sunset", contentType: "image/png") == "Golden hour. Sunset.png")
    #expect(ResultPreviewCard.Output.fileName(name: "chart.pdf", contentType: "image/png") == "chart.pdf.png")
    #expect(ResultPreviewCard.Output.fileName(name: "Version 1.5", contentType: "video/mp4") == "Version 1.5.mp4")
  }

  // MARK: Loading

  /// Each operation is called with its path and query and the workspace's slug, and its bytes land in a named file.
  @Test(arguments: [
    (ResultOutputSource.jobFile(jobId: "job 1", fileId: "blob-1", download: true), "get/jobs/{id}/files/{fileId}/content", "/jobs/job%201/files/blob-1/content", "download=true"),
    (.jobFile(jobId: "job-1", fileId: "blob-1", download: false), "get/jobs/{id}/files/{fileId}/content", "/jobs/job-1/files/blob-1/content", ""),
    (.driveFile(id: OutputFixture.file, scope: .organization, organizationId: "org_1", download: true), "get/drive/resources/{id}/content",
     "/drive/resources/\(OutputFixture.file)/content", "scope=org&organizationId=org_1&download=true"),
    (.driveFile(id: OutputFixture.file, scope: .personal, organizationId: nil, download: false), "get/drive/resources/{id}/content",
     "/drive/resources/\(OutputFixture.file)/content", "scope=me"),
    (.studioAsset(projectId: "p1", assetId: "a1"), "get/projects/{id}/image-studio/assets/{assetId}/content", "/projects/p1/image-studio/assets/a1/content", "")
  ])
  func anOutputLoadsThroughItsCoreOperationIntoANamedFile(source: ResultOutputSource, operation: String, path: String, query: String) async throws {
    let transport = TestTransport([(200, "%PDF-1.7 fixture bytes")])
    let file = try await ChatService().resultOutput(client: makeTestClient(transport), source: source, fileName: "report.pdf", organizationSlug: "acme")
    #expect(file.url.lastPathComponent == "report.pdf")
    #expect(try Data(contentsOf: file.url) == Data("%PDF-1.7 fixture bytes".utf8))
    let request = try #require(transport.requests.first)
    #expect(request.operationID == operation)
    #expect(request.request.method == .get)
    #expect(request.request.path?.split(separator: "?").first.map { $0.hasSuffix(path) } == true, "\(request.request.path ?? "")")
    #expect(testRequestQuery(request.request) == query)
    #expect(testOrgSlugHeader(request.request) == "acme")
  }

  /// The local copy lives while something holds it: the viewer, the player or the save.
  @Test func theLocalFileGoesWhenNothingHoldsIt() async throws {
    let transport = TestTransport([(200, "bytes")])
    var file: ResultOutputFile? = try await ChatService().resultOutput(client: makeTestClient(transport), source: .studioAsset(projectId: "p1", assetId: "a1"),
                                                                       fileName: "fox.png", organizationSlug: nil)
    let url = try #require(file?.url)
    #expect(FileManager.default.fileExists(atPath: url.path))
    #expect(try testOrgSlugHeader(#require(transport.requests.first).request) == nil)
    file = nil
    #expect(!FileManager.default.fileExists(atPath: url.path))
    #expect(!FileManager.default.fileExists(atPath: url.deletingLastPathComponent().path))
  }

  /// 401 signs out like every chat request; a denied or missing file (403/404) and a storage outage (503) reach the
  /// control with Core's message.
  @Test(arguments: [401, 403, 404, 503], [
    ResultOutputSource.jobFile(jobId: "job-1", fileId: "blob-1", download: false),
    .driveFile(id: OutputFixture.file, scope: .personal, organizationId: nil, download: true),
    .studioAsset(projectId: "p1", assetId: "a1")
  ])
  func coreRejectionsReachTheControl(status: Int, source: ResultOutputSource) async throws {
    let body = #"{"error":"No","message":"Output unavailable","meta":{"timestamp":"\#(testTimestamp)","requestId":"req-1","path":"/x","method":"GET"}}"#
    let transport = TestTransport([(status, body)])
    let error = await #expect(throws: ChatServiceError.self) {
      try await ChatService().resultOutput(client: makeTestClient(transport), source: source, fileName: "x", organizationSlug: nil)
    }
    switch error {
    case .unauthorized: #expect(status == 401)
    case let .unprocessable(statusCode, message):
      #expect(statusCode == status)
      #expect(message == "Output unavailable")
    default: Issue.record("unexpected error \(String(describing: error))")
    }
  }
}

import Foundation
@testable import SokosumiChat
import Testing

/// Row 14a2: a draft chip previews its file as web's `FileChipMiniPreview` does — an image by its media
/// type, URL or name, anything else as a document — and names the file and its size on hover.
@Test(arguments: [
  ("https://blob.example/rooms/r1/photo-a1b2.png", "photo.png", "image/png", MessageAttachment.Kind.image),
  ("https://blob.example/rooms/r1/a1b2", "scan", "image/jpeg", .image),
  ("https://blob.example/rooms/r1/a1b2", "holiday.HEIC", "", .image),
  ("https://blob.example/rooms/r1/report-a1b2.pdf", "report.pdf", "application/pdf", .file),
  ("https://blob.example/drive/report.pdf", "report.pdf", "", .file),
  ("https://blob.example/rooms/r1/clip-a1b2.mp4", "clip.mp4", "video/mp4", .video),
  ("https://blob.example/rooms/r1/a1b2", "voice memo", "audio/mpeg", .audio),
  ("https://blob.example/rooms/r1/archive-a1b2.zip", "archive.zip", "application/zip", .file)
])
func draftPreviewClassifiesByMediaTypeURLAndName(url: String, fileName: String, mediaType: String, kind: MessageAttachment.Kind) throws {
  let preview = try #require(ComposeAttachment(url: url, fileName: fileName, mediaType: mediaType).preview)
  #expect(preview.kind == kind)
  #expect(preview.url.absoluteString == url)
  #expect(preview.filename == fileName)
}

@Test func draftDocumentsKeepTheirDocumentViewer() throws {
  let kinds = try [
    ("https://blob.example/r/report.pdf", "report.pdf", "application/pdf"),
    ("https://blob.example/r/a1b2", "Plan.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    ("https://blob.example/r/notes.md", "notes.md", "text/markdown"),
    ("https://blob.example/r/archive.zip", "archive.zip", "application/zip")
  ].map { try #require(ComposeAttachment(url: $0.0, fileName: $0.1, mediaType: $0.2).preview).documentPreviewKind }
  #expect(kinds == [.pdf, .office, .text, nil])
}

@Test func draftMetadataNamesTheFileAndItsSize() {
  let english = Locale(identifier: "en_US")
  #expect(ComposeAttachment(url: "https://blob.example/r/report.pdf", fileName: "report.pdf", mediaType: "application/pdf", size: 1_500_000)
    .metadata(locale: english) == "report.pdf\n1.5 MB")
  #expect(ComposeAttachment(url: "https://blob.example/r/a.png", fileName: "a.png", mediaType: "image/png", size: 2048)
    .metadata(locale: Locale(identifier: "de_DE")) == "a.png\n2 kB")
  #expect(ComposeAttachment(url: "https://blob.example/r/old.pdf", fileName: "old.pdf", mediaType: "application/pdf")
    .metadata(locale: english) == "old.pdf")
}

@Test func draftSizePersistsAndOlderDraftsStillLoad() throws {
  let name = "draft-preview-\(UUID().uuidString)"
  let defaults = try #require(UserDefaults(suiteName: name))
  defer { defaults.removePersistentDomain(forName: name) }
  let draft = SavedComposeDraft(userId: "me", organizationId: nil, roomId: "room", defaults: defaults)
  let sized = ComposeAttachment(url: "https://blob.example/r/report.pdf", fileName: "report.pdf", mediaType: "application/pdf", size: 1_500_000)
  draft.saveAttachments([sized])
  #expect(draft.loadAttachments() == [sized])
  #expect(draft.loadAttachments().first?.size == 1_500_000)
  // A draft saved before sizes were kept has no `size` key.
  let legacy = Data(#"[{"url":"https://blob.example/r/a.png","fileName":"a.png","mediaType":"image/png"}]"#.utf8)
  #expect(try JSONDecoder().decode([ComposeAttachment].self, from: legacy)
    == [ComposeAttachment(url: "https://blob.example/r/a.png", fileName: "a.png", mediaType: "image/png")])
}

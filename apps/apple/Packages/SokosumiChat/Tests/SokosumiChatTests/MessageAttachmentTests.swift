import Foundation
import SokosumiChat
import Testing

@Test func attachmentLinksPreserveTextAndOccurrenceOrder() {
  let document = MessageMarkdown("Before [report](https://example.com/report.pdf) between [photo](https://example.com/photo.png?token=1) after")
  let segments = MessageAttachmentSegment.split(document.blocks[0].text)
  #expect(segments.count == 5)
  #expect(String(segments[0].text.characters) == "Before ")
  #expect(segments[1].attachment?.kind == .file)
  #expect(String(segments[2].text.characters) == " between ")
  #expect(segments[3].attachment?.kind == .image)
  #expect(String(segments[4].text.characters) == " after")
  #expect(Set(segments.map(\.id)).count == segments.count)
}

@Test func explicitImagesCanHaveExtensionlessURLs() {
  let document = MessageMarkdown("![A photo](https://example.com/image/123)")
  let attachment = MessageAttachmentSegment.split(document.blocks[0].text).first?.attachment
  #expect(attachment?.kind == .image)
  #expect(attachment?.filename == "A photo")
}

@Test func attachmentClassificationMatchesWebLinks() throws {
  for path in ["movie.mov", "movie.mp4"] {
    #expect(try MessageAttachment(url: #require(URL(string: "https://example.com/" + path)), label: path)?.kind == .video)
  }
  #expect(try MessageAttachment(url: #require(URL(string: "https://example.com/song.mp3")), label: "Song")?.kind == .audio)
  #expect(try MessageAttachment(url: #require(URL(string: "https://example.com/deliverables/123")), label: "report.pdf")?.kind == .file)
  for value in ["file:///tmp/file.pdf", "javascript:alert(1)", "https://example.com/page", "https://example.com/a.pdf#page=2", "https://example.com/a.exe"] {
    #expect(try MessageAttachment(url: #require(URL(string: value)), label: "file.pdf") == nil)
  }
}

@Test func codeAndOrdinaryLinksStayText() {
  let document = MessageMarkdown("`[file](https://example.com/a.pdf)` and [website](https://example.com)")
  #expect(MessageAttachmentSegment.split(document.blocks[0].text).allSatisfy { $0.attachment == nil })
}

@Test func formattedAttachmentLabelRemainsOnePreview() {
  let document = MessageMarkdown("[**Annual** report](https://example.com/a.pdf)")
  let segments = MessageAttachmentSegment.split(document.blocks[0].text)
  #expect(segments.count == 1)
  #expect(segments.first?.attachment?.filename == "Annual report")
}

@Test func HTMLMediaKeepsNativePreviewKindWithoutExtension() {
  for (tag, kind) in [("img", MessageAttachment.Kind.image), ("audio", .audio), ("video", .video)] {
    let document = MessageMarkdown("<\(tag) src=\"https://example.com/media/123\"></\(tag)>")
    let segments = document.blocks.flatMap { MessageAttachmentSegment.split($0.text) }
    #expect(segments.first?.attachment?.kind == kind)
  }
}

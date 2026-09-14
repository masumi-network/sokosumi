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

@Test func markdownImageWithVideoExtensionPlaysAsVideo() {
  let document = MessageMarkdown("![clip](https://example.com/clip.mp4)")
  #expect(MessageAttachmentSegment.split(document.blocks[0].text).first?.attachment?.kind == .video)
}

@Test func htmlImageWithVideoExtensionPlaysAsVideo() {
  let document = MessageMarkdown("<img src=\"https://example.com/clip.mp4\">")
  let segments = document.blocks.flatMap { MessageAttachmentSegment.split($0.text) }
  #expect(segments.first?.attachment?.kind == .video)
}

@Test func documentReportsAttachments() {
  #expect(MessageMarkdown("hello ![A](https://example.com/a.png)").containsAttachments)
  #expect(!MessageMarkdown("hello [site](https://example.com)").containsAttachments)
}

@Test func attachmentLayoutRemovesBoundaryLineBreaksButPreservesParagraphs() throws {
  var text = AttributedString("First line\nSecond line\n\n")
  var link = AttributedString("report.pdf")
  link.link = try #require(URL(string: "https://example.com/report.pdf"))
  text.append(link)
  text.append(AttributedString("\n\nFollowing text"))
  let segments = MessageAttachmentSegment.split(text)
  #expect(String(segments[0].text.characters) == "First line\nSecond line")
  #expect(segments[1].attachment?.kind == .file)
  #expect(String(segments[2].text.characters) == "Following text")
}

@Test func documentPreviewKindsMatchSupportedFiles() throws {
  for ext in ["txt", "md", "markdown", "TXT", "MD", "MARKDOWN"] {
    let url = try #require(URL(string: "https://example.com/report.\(ext)?download=1"))
    let attachment = try #require(MessageAttachment(url: url, label: "Report"))
    #expect(attachment.documentPreviewKind == .text)
  }
  let namedURL = try #require(URL(string: "https://example.com/deliverables/id"))
  let named = try #require(MessageAttachment(url: namedURL, label: "report.markdown"))
  #expect(named.documentPreviewKind == .text)
  let pdfURL = try #require(URL(string: "https://example.com/report.pdf"))
  let pdf = try #require(MessageAttachment(url: pdfURL, label: "Report"))
  #expect(pdf.documentPreviewKind == .pdf)
  for ext in ["zip", "json", "csv"] {
    let url = try #require(URL(string: "https://example.com/report.\(ext)"))
    let attachment = try #require(MessageAttachment(url: url, label: "Report"))
    #expect(attachment.documentPreviewKind == nil)
  }
}

@Test func textPreviewKeepsFileLinksInlineAndPreservesParagraphText() throws {
  let parsed = MessageMarkdown("Read [the PDF](https://example.com/report.pdf) before **continuing**.")
  let block = try #require(parsed.blocks.first)
  let segments = MessageAttachmentSegment.split(block.text, includeFileAttachments: false)
  #expect(segments.count == 1)
  #expect(segments.first?.text == block.text)
  #expect(segments.first?.attachment == nil)
  #expect(segments.first?.text.runs.contains { $0.link != nil } == true)
}

@Test func markdownFileLinksRoundTripToTextPreview() throws {
  for ext in ["markdown", "MARKDOWN"] {
    let parsed = MessageMarkdown("Read [report](https://example.com/report.\(ext)) now.")
    let block = try #require(parsed.blocks.first)
    let segments = MessageAttachmentSegment.split(block.text)
    #expect(segments.count == 3)
    #expect(segments[1].attachment?.documentPreviewKind == .text)
  }
}

@Test func documentPreviewPrefersRecognizedURLKindOverFilename() throws {
  let textURL = try #require(URL(string: "https://example.com/report.txt"))
  #expect(MessageAttachment(url: textURL, label: "report.pdf")?.documentPreviewKind == .text)
  let pdfURL = try #require(URL(string: "https://example.com/report.pdf"))
  #expect(MessageAttachment(url: pdfURL, label: "report.txt")?.documentPreviewKind == .pdf)
  let officeURL = try #require(URL(string: "https://example.com/report.docx"))
  #expect(MessageAttachment(url: officeURL, label: "report.txt")?.documentPreviewKind == .office)
}

@Test func officeDocumentsUseURLThenFilenameForNativePreview() throws {
  for ext in ["doc", "docx", "ppt", "pptx", "xls", "xlsx", "DOCX"] {
    let url = try #require(URL(string: "https://example.com/report.\(ext)"))
    let attachment = try #require(MessageAttachment(url: url, label: "Report"))
    #expect(attachment.documentPreviewKind == .office)
    #expect(attachment.documentPreviewExtension == ext.lowercased())
  }
  let url = try #require(URL(string: "https://example.com/deliverables/id"))
  let attachment = try #require(MessageAttachment(url: url, label: "deck.pptx"))
  #expect(attachment.documentPreviewKind == .office)
  #expect(attachment.documentPreviewExtension == "pptx")
}

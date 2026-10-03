import CoreAPI
import Foundation
import SokosumiChat
import Testing

struct MessageAttachmentRunTests {
  private func link(_ name: String) -> String {
    "[\(name)](https://example.com/\(name))"
  }

  @Test func whitespaceAcrossParagraphsMakesOneRun() {
    let document = MessageMarkdown(link("a.png") + " \t\n\n" + link("b.png"))
    #expect(document.segments.count == 1)
    #expect(document.segments.first?.attachments.map(\.filename) == ["a.png", "b.png"])
    #expect(document.segments.first?.usesLargeImage == false)
    #expect(document.clampsLongBody)
  }

  @Test func textAndMixedAttachmentsKeepTheirOrder() {
    let document = MessageMarkdown("**Before** " + link("a.png") + " " + link("report.pdf") + " after " + link("b.png"))
    #expect(document.segments.map { $0.attachments.map(\.filename) } == [[], ["a.png", "report.pdf"], [], ["b.png"]])
    #expect(document.segments.map(\.usesLargeImage) == [false, false, false, true])
    #expect(document.segments.first?.blocks.first?.text.runs.first?.inlinePresentationIntent?.contains(.stronglyEmphasized) == true)
    #expect(!document.clampsLongBody)
  }

  @Test func structuralMarkersBreakRuns() {
    for gap in ["\n- ", "\n> ", "\n\n---\n\n", " | "] {
      let document = MessageMarkdown(link("a.png") + gap + link("b.png"))
      #expect(document.segments.filter { !$0.attachments.isEmpty }.map(\.attachments.count) == [1, 1])
      #expect(!document.clampsLongBody)
    }
  }

  @Test func repeatedURLsRemainSeparateTilesButOneGalleryImage() {
    let document = MessageMarkdown(link("a.png") + " " + link("a.png"))
    #expect(document.segments.first?.attachments.count == 2)
    #expect(document.imageGallery.images.map(\.filename) == ["a.png"])
  }

  @Test func mediaKeepTheirKindsAndOnlySoloImagesAreLarge() {
    let document = MessageMarkdown(link("a.mp3") + " " + link("b.mp4") + " " + link("c.png"))
    #expect(document.segments.first?.attachments.map(\.kind) == [.audio, .video, .image])
    #expect(document.segments.first?.usesLargeImage == false)
  }

  @Test func textChunksKeepMentionAndChannelLinks() {
    let user = Components.Schemas.ChatRoomUserParticipant(id: "peer", name: "Anna", email: "anna@example.com", image: nil, presence: .online)
    let room = Components.Schemas.ChatRoom(id: "room", name: "Room", kind: .direct, isSelfDirect: false, isGroupDirect: false, isReadOnly: false, createdByUserId: "peer", createdAt: Date(timeIntervalSince1970: 0), updatedAt: Date(timeIntervalSince1970: 0), unreadCount: 0, unreadMentionCount: 0, markedUnread: false, myAccess: .init(value1: .member, value2: "member"), userMembers: [user], formerUserMembers: [], coworkerMembers: [], sokoBotMembers: [])
    let channels = [ComposerChannel(id: "launch", name: "Launch", slug: "launch")]
    let document = MessageMarkdown("@peer:old " + link("a.png") + " #launch", mentions: MessageMentions(room: room), channels: channels)
    #expect(document.segments.count == 3)
    #expect(document.segments.first?.blocks.first?.text.runs.first?.link?.scheme == "sokosumi-participant")
    #expect(document.segments.last?.blocks.first?.text.runs.compactMap(\.link).first?.scheme == "sokosumi-channel")
  }

  /// Row 31b3 (web `endsWithAttachmentRow`): the newest row keeps the Seen by corner clear when its body's last
  /// segment is a run of files — a picture, a document, media or a mix — whatever text came before it.
  @Test(arguments: [
    "![photo](https://example.com/photo.png)",
    "[report.pdf](https://example.com/report.pdf)",
    "[a.png](https://example.com/a.png) [b.mp4](https://example.com/b.mp4) [notes.pdf](https://example.com/notes.pdf)",
    "Here are Friday's files.\n\n[a.png](https://example.com/a.png)",
    "[a.png](https://example.com/a.png)\n\n  \n\n"
  ])
  func aBodyEndingInAFileRunEndsWithAnAttachmentRun(source: String) {
    #expect(MessageMarkdown.endsWithAttachmentRun(source))
    #expect(MessageMarkdown(source).segments.last?.files.isEmpty == false, "Agrees with what the row draws")
  }

  /// Text after the run, text alone, an empty body (Send to yourself posts only a quote) and a file link inside
  /// code all end the body in text, so the row keeps no corner.
  @Test(arguments: [
    "[a.png](https://example.com/a.png)\n\nThat's the one.",
    "Release notes are up.",
    "",
    "   \n",
    "[a.png](https://example.com/a.png)\n\n```\n[b.png](https://example.com/b.png)\n```",
    "[docs](https://example.com/docs)"
  ])
  func aBodyEndingInTextDoesNot(source: String) {
    #expect(!MessageMarkdown.endsWithAttachmentRun(source))
    #expect(MessageMarkdown(source).segments.last?.files.isEmpty == true, "Agrees with what the row draws")
  }

  @Test func codeStaysTextBesideAnAttachmentRun() {
    let document = MessageMarkdown("`" + link("code.png") + "`\n\n" + link("a.png") + " " + link("b.png"))
    #expect(document.segments.count == 2)
    #expect(document.segments.last?.attachments.map(\.filename) == ["a.png", "b.png"])
    #expect(document.imageGallery.images.map(\.filename) == ["a.png", "b.png"])
  }
}

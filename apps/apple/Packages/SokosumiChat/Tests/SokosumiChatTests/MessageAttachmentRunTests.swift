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
    let room = Components.Schemas.ChatRoom(id: "room", name: "Room", kind: .direct, isSelfDirect: false, isGroupDirect: false, createdByUserId: "peer", createdAt: Date(timeIntervalSince1970: 0), updatedAt: Date(timeIntervalSince1970: 0), unreadCount: 0, unreadMentionCount: 0, markedUnread: false, myAccess: .member, userMembers: [user], coworkerMembers: [], sokoBotMembers: [])
    let channels = [ComposerChannel(id: "launch", name: "Launch", slug: "launch")]
    let document = MessageMarkdown("@peer:old " + link("a.png") + " #launch", mentions: MessageMentions(room: room), channels: channels)
    #expect(document.segments.count == 3)
    #expect(document.segments.first?.blocks.first?.text.runs.first?.link?.scheme == "sokosumi-participant")
    #expect(document.segments.last?.blocks.first?.text.runs.compactMap(\.link).first?.scheme == "sokosumi-channel")
  }

  @Test func codeStaysTextBesideAnAttachmentRun() {
    let document = MessageMarkdown("`" + link("code.png") + "`\n\n" + link("a.png") + " " + link("b.png"))
    #expect(document.segments.count == 2)
    #expect(document.segments.last?.attachments.map(\.filename) == ["a.png", "b.png"])
    #expect(document.imageGallery.images.map(\.filename) == ["a.png", "b.png"])
  }
}

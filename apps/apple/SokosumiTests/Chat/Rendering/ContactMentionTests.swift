#if os(macOS)
  import AppKit
  import CoreAPI
  @testable import Sokosumi
  import SokosumiWorkspace
  import SwiftUI
  import Testing

  private typealias Host = NativeWindowTests.SokoBotResultPreviewsTests

  extension NativeWindowTests {
    @MainActor struct ContactMentionTests {
      @Test func theContactCardOnlyOpensContactsOnItsExplicitAction() async throws {
        let date = Date(timeIntervalSince1970: 0)
        let contact = Components.Schemas.Contact(id: "contact", name: "Mira Quill", organization: "Prism Studio", role: "Editor", stage: .community,
                                                 kind: .person, customFields: .init(), firstContactAt: date, interactionCount: 0, version: 1,
                                                 createdAt: date, updatedAt: date, channels: [], lists: [], knownBy: [])
        let destination = try #require(URL(string: "https://chat.example/contacts?contact=018f0000-0000-7000-8000-000000000001"))
        var opened: [URL] = []
        let card = ContactMentionCard(details: .available(contact, destination)) { opened.append($0) }
        let (window, host) = Host.window(card, size: .init(width: 320, height: 165))
        defer { window.orderOut(nil) }
        let words = try await Host.waitForText("Open in Contacts", in: host)
        #expect(words.contains("Mira Quill"))
        #expect(words.contains("Editor"))
        #expect(words.contains("Prism Studio"))
        #expect(opened.isEmpty)
        #expect(await Host.pressAll("Open in Contacts", in: host) > 0)
        #expect(opened == [destination])
        var columns: [[CGImage]] = []
        for dark in [false, true] {
          try await columns.append([Host.draw(card, size: .init(width: 320, height: 165), dark: dark, until: "Open in Contacts")])
        }
        let combined = try RoomHeaderTests.stitched(columns)
        try Attachment.record(#require(combined.representation(using: .png, properties: [:])), named: "contact-card.png")
      }
    }
  }
#endif

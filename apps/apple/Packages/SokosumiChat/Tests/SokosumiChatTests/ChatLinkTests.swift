import Foundation
@testable import SokosumiChat
import Testing

struct ChatLinkTests {
  private let base = URL(string: "https://app.sokosumi.com")!

  @Test(arguments: ["", "&workspace=018f0000-0000-7000-8000-000000000002"])
  func contactLinksInRenderedMessagesResolveOnTheirPreview(_ scope: String) throws {
    let preview = try #require(URL(string: "https://preview.sokosumi.localhost"))
    let contact = "/contacts?contact=018f0000-0000-7000-8000-000000000001"
    let document = MessageMarkdown("[Guest](\(contact)\(scope))", baseURL: preview)
    let target = try #require(document.blocks.first?.text.runs.compactMap(\.link).first)
    guard case let .contact(mention) = ChatLink(url: target, webBaseURL: preview) else {
      Issue.record("Expected a contact popover destination")
      return
    }
    #expect(mention.id == "018f0000-0000-7000-8000-000000000001")
    #expect(mention.workspaceId == (scope.isEmpty ? nil : "018f0000-0000-7000-8000-000000000002"))
    #expect(mention.url == target)
    #expect(ChatLink(url: target, webBaseURL: base) == nil)
  }

  @Test(arguments: [
    "/contacts", "/contacts?contact=unconfirmed", "/contacts?contact=&workspace=018f0000-0000-7000-8000-000000000002",
    "/contacts?contact=018f0000-0000-7000-8000-000000000001&workspace=unknown",
    "/contacts?contact=018f0000-0000-7000-8000-000000000001&contact=018f0000-0000-7000-8000-000000000002",
    "/contacts?contact=018f0000-0000-7000-8000-000000000001&sort=name"
  ]) func ambiguousOrUnrelatedDestinationsDoNotReadAContact(_ path: String) throws {
    #expect(try ChatLink(url: #require(URL(string: path, relativeTo: base)), webBaseURL: base) == nil)
  }

  @Test func buildsRoomAndMessageURL() throws {
    let url = try #require(ChatLink.href(roomId: "room", messageId: "old", webBaseURL: base))
    #expect(url.absoluteString == "https://app.sokosumi.com/chat/rooms/room?message=old")
    #expect(ChatLink(url: url, webBaseURL: base) == .room(id: "room", messageId: "old"))
  }

  @Test func buildsRoomURLWhenMessageIsBlank() throws {
    let url = try #require(ChatLink.href(roomId: "room", messageId: "  ", webBaseURL: base))
    #expect(url.absoluteString == "https://app.sokosumi.com/chat/rooms/room")
    #expect(ChatLink(url: url, webBaseURL: base) == .room(id: "room", messageId: nil))
  }

  @Test func resolvesRoomAndMessage() throws {
    let url = try #require(URL(string: "https://app.sokosumi.com/chat/rooms/room?message=%20old%20"))
    #expect(ChatLink(url: url, webBaseURL: base) == .room(id: "room", messageId: "old"))
    let blank = try #require(URL(string: "https://app.sokosumi.com/chat/rooms/room?message=%20"))
    #expect(ChatLink(url: blank, webBaseURL: base) == .room(id: "room", messageId: nil))
  }

  @Test(arguments: [
    "https://APP.SOKOSUMI.COM/chat/rooms/room?message=old",
    "https://app.sokosumi.com/chat/rooms/room/?message=old"
  ]) func equivalentChatURLsStayInApp(_ value: String) throws {
    let url = try #require(URL(string: value))
    #expect(ChatLink(url: url, webBaseURL: base) == .room(id: "room", messageId: "old"))
  }

  /// Web `/chat/invites/{id}` and `/chat/join/{token}` open natively; a message query is meaningless there and ignored.
  @Test func resolvesInvitationAndJoinLinks() throws {
    let invite = try #require(URL(string: "https://app.sokosumi.com/chat/invites/550e8400-e29b-41d4-a716-446655440010?message=x"))
    #expect(ChatLink(url: invite, webBaseURL: base) == .invitation(id: "550e8400-e29b-41d4-a716-446655440010"))
    let join = try #require(URL(string: "https://app.sokosumi.com/chat/join/tok_abc/"))
    #expect(ChatLink(url: join, webBaseURL: base) == .guestJoin(token: "tok_abc"))
  }

  @Test(arguments: [
    "https://app.sokosumi.com.evil.test/chat/rooms/room",
    "http://app.sokosumi.com/chat/rooms/room",
    "https://app.sokosumi.com:8443/chat/rooms/room",
    "https://someone@app.sokosumi.com/chat/rooms/room",
    "https://app.sokosumi.com/tasks/room",
    "https://app.sokosumi.com/chat/rooms/",
    "https://app.sokosumi.com/chat/rooms/room/extra",
    "https://app.sokosumi.com/chat/rooms/room//",
    "https://app.sokosumi.com/chat/rooms/room%2Fextra",
    "https://app.sokosumi.com/chat/invites/",
    "https://app.sokosumi.com/chat/join/tok/extra",
    "https://app.sokosumi.com/chat/welcome/x"
  ]) func unrelatedOrInvalidURLsStayExternal(_ value: String) throws {
    let url = try #require(URL(string: value))
    #expect(ChatLink(url: url, webBaseURL: base) == nil)
  }
}

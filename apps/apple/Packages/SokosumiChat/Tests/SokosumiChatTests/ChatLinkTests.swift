import Foundation
@testable import SokosumiChat
import Testing

struct ChatLinkTests {
  private let base = URL(string: "https://app.sokosumi.com")!

  @Test func buildsRoomAndMessageURL() throws {
    let link = ChatLink(roomId: "room", messageId: "old")
    let url = try #require(link.url(webBaseURL: base))
    #expect(url.absoluteString == "https://app.sokosumi.com/chat/rooms/room?message=old")
    #expect(ChatLink(url: url, webBaseURL: base) == link)
  }

  @Test func buildsRoomURLWhenMessageIsBlank() throws {
    let link = ChatLink(roomId: "room", messageId: "  ")
    let url = try #require(link.url(webBaseURL: base))
    #expect(url.absoluteString == "https://app.sokosumi.com/chat/rooms/room")
    #expect(ChatLink(url: url, webBaseURL: base)?.messageId == nil)
  }

  @Test func resolvesRoomAndMessage() throws {
    let url = try #require(URL(string: "https://app.sokosumi.com/chat/rooms/room?message=%20old%20"))
    let link = ChatLink(url: url, webBaseURL: base)
    #expect(link?.roomId == "room")
    #expect(link?.messageId == "old")
    let blank = try #require(URL(string: "https://app.sokosumi.com/chat/rooms/room?message=%20"))
    let room = ChatLink(url: blank, webBaseURL: base)
    #expect(room?.roomId == "room")
    #expect(room?.messageId == nil)
  }

  @Test(arguments: [
    "https://APP.SOKOSUMI.COM/chat/rooms/room?message=old",
    "https://app.sokosumi.com/chat/rooms/room/?message=old"
  ]) func equivalentChatURLsStayInApp(_ value: String) throws {
    let url = try #require(URL(string: value))
    let link = ChatLink(url: url, webBaseURL: base)
    #expect(link?.roomId == "room")
    #expect(link?.messageId == "old")
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
    "https://app.sokosumi.com/chat/rooms/room%2Fextra"
  ]) func unrelatedOrInvalidURLsStayExternal(_ value: String) throws {
    let url = try #require(URL(string: value))
    let link = ChatLink(url: url, webBaseURL: base)
    #expect(link == nil)
  }
}

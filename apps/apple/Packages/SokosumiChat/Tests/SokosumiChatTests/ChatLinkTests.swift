import Foundation
@testable import SokosumiChat
import Testing

struct ChatLinkTests {
  private let base = URL(string: "https://app.sokosumi.com")!

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
    "https://app.sokosumi.com.evil.test/chat/rooms/room",
    "http://app.sokosumi.com/chat/rooms/room",
    "https://app.sokosumi.com:8443/chat/rooms/room",
    "https://someone@app.sokosumi.com/chat/rooms/room",
    "https://app.sokosumi.com/tasks/room",
    "https://app.sokosumi.com/chat/rooms/",
    "https://app.sokosumi.com/chat/rooms/room/extra",
    "https://app.sokosumi.com/chat/rooms/room%2Fextra"
  ]) func unrelatedOrInvalidURLsStayExternal(_ value: String) throws {
    let url = try #require(URL(string: value))
    let link = ChatLink(url: url, webBaseURL: base)
    #expect(link == nil)
  }
}

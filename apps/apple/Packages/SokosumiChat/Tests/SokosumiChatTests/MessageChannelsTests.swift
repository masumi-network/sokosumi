import Foundation
@testable import SokosumiChat
import Testing

struct MessageChannelsTests {
  @Test func linksKnownChannelsAndRejectsAmbiguityCodeAndStaleTargets() throws {
    let channels = [ComposerChannel(id: "launch", name: "Launch Room", slug: "launch-room"),
                    ComposerChannel(id: "one", name: "General", slug: "general"),
                    ComposerChannel(id: "two", name: "General", slug: "general-2")]
    let source = "#Launch Room! #general #general-2 #unknown `#launch-room` [#launch-room](https://example.com)"
    let text = try #require(MessageMarkdown(source, channels: channels).blocks.first?.text)
    let links = text.runs.compactMap(\.link)
    #expect(links.count == 3)
    #expect(links.compactMap { MessageChannels.roomId(for: $0, channels: channels) } == ["launch", "two"])
    #expect(try MessageChannels.roomId(for: #require(links.first), channels: []) == nil)
    let code = try #require(MessageMarkdown("```\n#launch-room\n```", channels: channels).blocks.first)
    #expect(code.text.runs.allSatisfy { $0.link == nil })
  }
}

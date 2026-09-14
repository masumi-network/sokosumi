import Foundation
@testable import SokosumiChat
import Testing

struct ScrollParsingPerformanceTests {
  @Test func plainMessagesWithChannelCatalog() {
    let channels = (0 ..< 80).map {
      ComposerChannel(id: "room-\($0)", name: "Channel \($0)", slug: "channel-\($0)")
    }
    let clock = ContinuousClock()
    let elapsed = clock.measure {
      for _ in 0 ..< 100 {
        let document = MessageMarkdown("An update with **formatting**.\n\n- First item\n- Second item\n\nhttps://example.com/preview", channels: channels)
        #expect(document.blocks.count == 3)
      }
    }
    print("SCROLL_PARSING_DURATION \(elapsed)")
    #expect(elapsed < .seconds(1))
  }
}

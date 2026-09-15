import Foundation
@testable import SokosumiChat
import Testing

struct ChatMessagePreviewTests {
  /// Captured from the shared web formatter and its existing tests at 05b622d79.
  /// Covers representable buildChatMessagePreview inputs, including named-preview tests.
  /// One lone-surrogate case is excluded: Swift String cannot hold malformed UTF-16.
  @Test func matchesWebPreviewCorpus() throws {
    let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
      .appendingPathComponent("Fixtures/chat-message-preview.json")
    let examples = try JSONDecoder().decode([Example].self, from: Data(contentsOf: url))
    #expect(examples.count == 177)
    for example in examples {
      #expect(ChatMessagePreview.text(example.content, names: example.names) == example.expected, "\(example.name)")
    }
  }

  @Test func removesRepresentableInvisibleCharacters() {
    #expect(ChatMessagePreview.text("www\u{0}\u{85}\u{200b}.example.test\u{202e} hidden") == "hidden")
    #expect(ChatMessagePreview.text("family 👨‍👩‍👧‍👦 and 1️⃣") == "family 👨‍👩‍👧‍👦 and 1️⃣")
  }

  private struct Example: Decodable {
    let name: String
    let content: String
    let names: [String: String]
    let expected: String
  }
}

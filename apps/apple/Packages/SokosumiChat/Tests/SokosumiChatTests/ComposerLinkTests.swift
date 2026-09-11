import SokosumiChat
import Testing

struct ComposerLinkTests {
  @Test func validatesComposerURLSchemes() {
    #expect(ComposerLink.normalizedURL(" https://EXAMPLE.com ") == "https://example.com/")
    #expect(ComposerLink.normalizedURL("mailto:a@example.com") == "mailto:a@example.com")
    for value in ["", "example.com", "/relative", "javascript:alert(1)", "file:///tmp/a", "https://bad host"] {
      #expect(ComposerLink.normalizedURL(value) == nil)
    }
  }
}

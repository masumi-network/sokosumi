import Foundation
@testable import SokosumiChat
import Testing

struct MarkdownBareDomainsTests {
  @Test func rewritesDomainsAndEscapesPaths() {
    let fixtures = [
      "see google.com please": "see [google.com](https://google.com) please",
      "naturstein-koester.de": "[naturstein-koester.de](https://naturstein-koester.de)",
      "google.com/maps?q=berlin#top": "[google.com/maps?q=berlin#top](https://google.com/maps?q=berlin#top)",
      "(google.com).": "([google.com](https://google.com)).",
      "xn--fsq.com": "[xn--fsq.com](https://xn--fsq.com)",
      "google.com/a\\b*c": "[google.com/a\\\\b\\*c](https://google.com/a\\\\b*c)",
      "👋 example.com": "👋 [example.com](https://example.com)"
    ]
    for (source, expected) in fixtures {
      #expect(MarkdownBareDomains(source).linkified() == expected)
    }
  }

  @Test func preservesExcludedText() {
    let fixtures = [
      "[google.com](https://example.com \"Docs\")", "[docs](https://example.com/path)",
      "foo.bar", "report.pdf?x=1 photo.png#a", "https://google.com http://example.com/a",
      "www.google.com", "user@google.com", "`google.com`", "``google.com``",
      "```\ngoogle.com\n```", "~~~\ngoogle.com\n~~~", "```\ngoogle.com",
      "192.168.1.1 localhost:3000 v1.2.3 i.e.", "report.pdf photo.png", "hello world",
      "<https://example.com>", "<span title='example.com'>", "_example.com", "/example.com"
    ]
    for source in fixtures {
      #expect(MarkdownBareDomains(source).linkified() == source)
    }
  }

  @Test func nativeParsingKeepsLinksAndTaskSourcePositions() throws {
    let markdown = MessageMarkdown("- [x] See example.com/a_b now\n- [ ] Next example.org")
    let items = try #require(markdown.blocks.first?.children)
    #expect(items.map(\.taskChecked) == [true, false])
    let text = try #require(items.first?.children.first?.text)
    #expect(String(text.characters) == "See example.com/a_b now")
    #expect(text.runs.compactMap(\.link).first?.absoluteString == "https://example.com/a_b")
  }
}

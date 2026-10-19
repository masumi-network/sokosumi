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
      "👋 example.com": "👋 [example.com](https://example.com)",
      "medium.com/@user": "[medium.com/@user](https://medium.com/@user)",
      "https://google.com http://example.com/a_b": "[https://google.com](https://google.com) [http://example.com/a\\_b](http://example.com/a_b)",
      "www.google.com": "[www.google.com](http://www.google.com)",
      "see www.example.com/a_b.": "see [www.example.com/a\\_b](http://www.example.com/a_b).",
      "(www.example.com)": "([www.example.com](http://www.example.com))",
      "user@google.com": "[user@google.com](mailto:user@google.com)",
      "mail theshivangigupta.in@gmail.com please": "mail [theshivangigupta.in@gmail.com](mailto:theshivangigupta.in@gmail.com) please",
      "name.in+tag@gmail.com.": "[name.in+tag@gmail.com](mailto:name.in+tag@gmail.com).",
      "name.in_x@gmail.com": "[name.in\\_x@gmail.com](mailto:name.in_x@gmail.com)"
    ]
    for (source, expected) in fixtures {
      #expect(MarkdownBareDomains(source).linkified() == expected)
    }
  }

  @Test func preservesExcludedText() {
    let fixtures = [
      "[google.com](https://example.com \"Docs\")", "[docs](https://example.com/path)",
      "foo.bar", "report.pdf?x=1 photo.png#a",
      "www.", "https://", "see https:// later", "nothttps://example.com", "www.example", "www.com", "x.www.foo", "www.foo_bar.com", "foo@bar", "user@host-", "/user@google.com",
      "`google.com`", "``google.com``", "`user@google.com`",
      "```\ngoogle.com\n```", "~~~\ngoogle.com\n~~~", "```\ngoogle.com",
      "192.168.1.1 localhost:3000 v1.2.3 i.e.", "report.pdf photo.png", "hello world",
      "<https://example.com>", "<span title='example.com'>", "_example.com", "/example.com",
      "![](https://example.com/a.png)", "![](https://example.com/a.png \"shot\")",
      "[](https://example.com)", "![](www.example.com/a.png)", "![](name@example.com)",
      "`https://example.com`", "<img src=\"https://example.com/a.png\">"
    ]
    for source in fixtures {
      #expect(MarkdownBareDomains(source).linkified() == source)
    }
  }

  /// Web's remark-gfm autolinks URLs, `www.` hosts and emails; swift-markdown has no autolink extension, so the rewrite does it.
  @Test func autolinkLiteralsBecomeLinks() throws {
    let fixtures = [
      "Mac App is available. https://github.com/masumi-network/sokosumi/releases/tag/macos-v1.0.0":
        "https://github.com/masumi-network/sokosumi/releases/tag/macos-v1.0.0",
      "see http://example.com/a_b*c, then": "http://example.com/a_b*c",
      "(https://example.com/path).": "https://example.com/path",
      "or www.example.com/docs": "http://www.example.com/docs",
      "write to name.in_x@gmail.com.": "mailto:name.in_x@gmail.com"
    ]
    for (source, url) in fixtures {
      let text = try #require(MessageMarkdown(source).blocks.first?.text)
      #expect(text.runs.compactMap(\.link).map(\.absoluteString) == [url], "\(source)")
      #expect(String(text.characters) == source, "The visible text stays the source: \(String(text.characters))")
    }
  }

  /// An empty alt is how pasted images are stored. The destination must stay a Markdown image.
  @Test func emptyLabelImageStaysAnImage() throws {
    let source = "![](https://example.com/a.png)"
    let text = try #require(MessageMarkdown(source).blocks.first?.text)
    #expect(String(text.characters) == "https://example.com/a.png")
    #expect(text.runs.compactMap(\.link).map(\.absoluteString) == ["https://example.com/a.png"])
    #expect(text.runs.contains { $0[MessageAttachmentKindAttribute.self] == .image })
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

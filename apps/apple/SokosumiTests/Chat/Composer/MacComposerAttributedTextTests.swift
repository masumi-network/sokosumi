#if os(macOS)
  import AppKit
  @testable import Sokosumi
  import SokosumiChat
  import Testing

  @MainActor
  struct MacComposerAttributedTextTests {
    @Test func nativeAppearanceRetainsPortableInlineMetadata() {
      let content: [ComposerDocument.Inline] = [.bold([.text("hello")]), .underline([.text(" world")])]
      let rendered = MacComposerAttributedText.render(ComposerDocument(blocks: [.paragraph(content)]))
      let editable = rendered.attributedSubstring(from: NSRange(location: 0, length: rendered.length - 1))
      #expect(ComposerInlineText.content(editable) == content)
    }

    @Test func rendersInlineStylesWithoutMarkdownMarkers() {
      let document = ComposerDocument(blocks: [.paragraph([
        .bold([.italic([.text("Hi")])]), .text(" "),
        .underline([.text("u")]), .strikethrough([.text("s")]),
        .code("code"), .link([.text("site")], destination: "https://example.com")
      ])])
      let text = MacComposerAttributedText.render(document)
      #expect(text.string == "Hi uscodesite\n")
      let font = text.attribute(.font, at: 0, effectiveRange: nil) as? NSFont
      #expect(font.map { NSFontManager.shared.traits(of: $0).contains([.boldFontMask, .italicFontMask]) } == true)
      #expect(text.attribute(.underlineStyle, at: 3, effectiveRange: nil) as? Int == NSUnderlineStyle.single.rawValue)
      #expect(text.attribute(.strikethroughStyle, at: 4, effectiveRange: nil) as? Int == NSUnderlineStyle.single.rawValue)
      #expect(text.attribute(.link, at: 9, effectiveRange: nil) as? String == "https://example.com")
    }

    @Test func rendersBlocksWithNativeIndentation() {
      let document = ComposerDocument(blocks: [
        .quote([.paragraph([.text("quote")])]),
        .orderedList([[.paragraph([.text("first")])], [.paragraph([.text("second")])]]),
        .code("print(1)", language: "swift")
      ])
      let text = MacComposerAttributedText.render(document)
      #expect(text.string == "quote\n1.\tfirst\n2.\tsecond\nprint(1)\n")
      #expect(ComposerBlockText.document(text) == document)
      let paragraph = text.attribute(.paragraphStyle, at: 0, effectiveRange: nil) as? NSParagraphStyle
      #expect(paragraph?.headIndent == 16)
    }
  }
#endif

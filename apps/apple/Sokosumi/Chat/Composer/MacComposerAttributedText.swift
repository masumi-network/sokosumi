#if os(macOS)
  import AppKit
  import SokosumiChat

  /// Maps portable composing semantics to native appearance, without changing content.
  enum MacComposerAttributedText {
    static func render(_ document: ComposerDocument) -> NSAttributedString {
      styled(ComposerBlockText.attributedText(document))
    }

    static func styled(_ semantic: NSAttributedString) -> NSAttributedString {
      let output = NSMutableAttributedString(attributedString: semantic)
      let fullRange = NSRange(location: 0, length: output.length)
      for key: NSAttributedString.Key in [.font, .foregroundColor, .backgroundColor, .underlineStyle, .strikethroughStyle, .link, .paragraphStyle] {
        output.removeAttribute(key, range: fullRange)
      }
      semantic.enumerateAttributes(in: NSRange(location: 0, length: semantic.length)) { values, range, _ in
        var styled: [NSAttributedString.Key: Any] = [.foregroundColor: NSColor.labelColor]
        let path = values[ComposerBlockText.path] as? [String] ?? []
        let kinds = path.map { $0.split(separator: ":", maxSplits: 2, omittingEmptySubsequences: false) }
        let isCodeBlock = kinds.last?.dropFirst().first == "c"
        var font = NSFont.preferredFont(forTextStyle: kinds.last?.dropFirst().first == "h" ? .headline : .body)
        let paragraph = NSMutableParagraphStyle()
        paragraph.headIndent = kinds.reduce(CGFloat.zero) { value, part in
          value + (part.dropFirst().first == "q" ? 16 : part.dropFirst().first == "i" ? 20 : 0)
        }
        paragraph.firstLineHeadIndent = paragraph.headIndent
        if kinds.contains(where: { $0.dropFirst().first == "i" }) {
          paragraph.firstLineHeadIndent = max(0, paragraph.headIndent - 20)
        }
        styled[.paragraphStyle] = paragraph
        if values[ComposerInlineText.bold] as? Bool == true {
          font = NSFontManager.shared.convert(font, toHaveTrait: .boldFontMask)
        }
        if values[ComposerInlineText.italic] as? Bool == true {
          font = NSFontManager.shared.convert(font, toHaveTrait: .italicFontMask)
        }
        if isCodeBlock || values[ComposerInlineText.code] as? Bool == true {
          font = .monospacedSystemFont(ofSize: font.pointSize, weight: .regular)
          styled[.backgroundColor] = NSColor.quaternaryLabelColor
        }
        styled[.font] = font
        if values[ComposerInlineText.underline] as? Bool == true {
          styled[.underlineStyle] = NSUnderlineStyle.single.rawValue
        }
        if values[ComposerInlineText.strikethrough] as? Bool == true {
          styled[.strikethroughStyle] = NSUnderlineStyle.single.rawValue
        }
        if let destination = values[ComposerInlineText.link] as? String {
          styled[.link] = destination
        }
        output.addAttributes(styled, range: range)
      }
      return output
    }
  }
#endif

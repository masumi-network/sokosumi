import Foundation

/// Mirrors normalizeLooseInlineMarkdown before document parsing, including fences.
enum MessageMarkdownNormalization {
  private static let replacements: [(NSRegularExpression, String)] = {
    let space = #"[\u0009-\u000D\u0020\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]"#
    do {
      return try [
        (NSRegularExpression(pattern: #"\*\*("# + space + #"*)(.+?)("# + space + #"*)\*\*"#), "$1**$2**$3"),
        (NSRegularExpression(pattern: #"~~("# + space + #"*)(.+?)("# + space + #"*)~~"#), "$1~~$2~~$3"),
        (NSRegularExpression(pattern: #"(^|[^\\])_("# + space + #"*)(.+?)("# + space + #"*)_"#), "$1$2_$3_$4")
      ]
    } catch {
      preconditionFailure("Invalid Markdown normalization pattern: \(error)")
    }
  }()

  static func applying(to source: String) -> String {
    replacements.reduce(source) { text, replacement in
      replacement.0.stringByReplacingMatches(
        in: text,
        range: NSRange(text.startIndex..., in: text),
        withTemplate: replacement.1
      )
    }
  }
}

import Foundation

/// Matches remark-emoji's two text-node passes using the approved web data.
enum MessageEmoji {
  private struct Emoticon: Decodable {
    let emoji: String
    let emoticons: [String]
  }

  private static let shortcodes: [String: String] = resource("shortcodes")
  private static let emoticons: [Emoticon] = resource("emoticons")
  private static let shortcodePattern = pattern(#":\+1:|:-1:|:[A-Za-z0-9_-]+:"#)
  private static let emoticonPattern = pattern(#"(^|[\u0009-\u000D\u0020\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF])[@$|*'",;.=:\-)(\[\]\\/<>038BOopPsSdDxXzZ]{2,5}"#)

  static func replacing(in text: String) -> String {
    let expanded = replacing(shortcodePattern, in: text) { match in
      shortcodes[String(match.dropFirst().dropLast())]
    }
    return replacing(emoticonPattern, in: expanded) { match in
      for (leading, trailing) in [(0, 0), (0, 1), (1, 0), (1, 1)] {
        let candidate = String(match.dropFirst(leading).dropLast(trailing))
        let prefix = String(match.prefix(leading))
        let suffix = String(match.suffix(trailing))
        if let icon = emoticons.first(where: { $0.emoticons.contains(candidate) }) {
          return prefix + icon.emoji + suffix
        }
      }
      return nil
    }
  }

  private static func replacing(
    _ expression: NSRegularExpression,
    in text: String,
    replacement: (String) -> String?
  ) -> String {
    var result = text
    for match in expression.matches(in: text, range: NSRange(text.startIndex..., in: text)).reversed() {
      guard let range = Range(match.range, in: result),
            let value = replacement(String(result[range]))
      else { continue }
      result.replaceSubrange(range, with: value)
    }
    return result
  }

  private static func pattern(_ source: String) -> NSRegularExpression {
    do {
      return try NSRegularExpression(pattern: source)
    } catch {
      preconditionFailure("Invalid emoji matching pattern: \(error)")
    }
  }

  private static func resource<Value: Decodable>(_ name: String) -> Value {
    guard let url = Bundle.module.url(forResource: name, withExtension: "json", subdirectory: "Emoji") else {
      preconditionFailure("Missing bundled emoji data: \(name)")
    }
    do {
      return try JSONDecoder().decode(Value.self, from: Data(contentsOf: url))
    } catch {
      preconditionFailure("Invalid bundled emoji data: \(name): \(error)")
    }
  }
}

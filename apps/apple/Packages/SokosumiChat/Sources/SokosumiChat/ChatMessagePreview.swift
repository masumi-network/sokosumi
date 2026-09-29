import Foundation

/// Plain-text thread labels matching packages/utils/src/chat-message-preview.ts.
/// Keep names outside Markdown cleanup, and remove addresses formed at name boundaries.
enum ChatMessagePreview {
  private static let token = #"@([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|[A-Za-z0-9]{32}|all)(?::([\p{L}\p{N}_-]*))?(?![\p{L}\p{N}_-])"#
  private static let controls = #"(?![\t\n\r\u200d])[\p{Cc}\p{Cf}\p{Cs}]"#
  private static let invisible = #"(?<=[\u0000-\u007f])(?:\u200d|[\ufe00-\ufe0f](?!\u20e3))|\u200d(?=[\u0000-\u007f])"#
  private static let address = #"(?i)(?:(?:https?|ftps?)://|(?<![A-Za-z0-9_])www\.)[A-Za-z0-9\-._~:/?#@!$&*+,;=%\[\]]+"#
  private static let seamAddress = #"(?i)@?(?:(?:https?|ftps?)://|www\.)[A-Za-z0-9\-._~:/?#@!$&*+,;=%\[\]]+"#

  static func text(_ content: String, names: [String: String] = [:]) -> String {
    let source = readable(content)
    var result = ""
    var spans: [NSRange] = []
    var offset = 0
    let body = source as NSString
    for match in matches(token, in: source) {
      result += withoutAddresses(body.substring(with: NSRange(location: offset, length: match.range.location - offset)))
      let key = body.substring(with: match.range(at: 1))
      let slug = match.range(at: 2).location == NSNotFound ? "" : body.substring(with: match.range(at: 2))
      let name = mentionName(key: key, slug: slug, names: names)
      spans.append(NSRange(location: result.utf16.count, length: name.utf16.count))
      result += name
      offset = NSMaxRange(match.range)
    }
    result += withoutAddresses(body.substring(from: offset))
    result = replacing(seamAddress, in: result) { match, value in
      guard spans.contains(where: { match.range.location < NSMaxRange($0) && NSMaxRange(match.range) > $0.location }) else {
        return value.substring(with: match.range)
      }
      return trailingPunctuation(value.substring(with: match.range))
    }
    return capped(replace(#"\s+"#, in: result, with: " ").trimmingCharacters(in: .whitespacesAndNewlines))
  }

  private static func readable(_ content: String) -> String {
    var text = stripInvisible(content)
    text = replace(#"(^|\n)(`{3,})([^\n]*)\n([\s\S]*?)\n\2(?=\n|$)"#, in: text, with: " ")
    text = replace(#"(?m)^ {0,3}(?:`{3,}[^`\n]*|~{3,}[^\n]*)$"#, in: text, with: "")
    for _ in 0 ..< 3 {
      let previous = text
      text = replace(#"<!--[\s\S]*?(?:-->|$)"#, in: text, with: " ")
      text = replace(#"(?i)<(script|style|textarea|option|xmp)\b[^>]*>[\s\S]*?(?:</\1\s*>|$)"#, in: text, with: " ")
      text = replace(#"(?m)^[^\S\n]*\[(?:\\[\s\S]|[^\]\\\[])+\][^\S\n]*:[^\S\n]*(?:\n[^\S\n]*)?\S+[^\S\n]*(?:(?:\n[^\S\n]*)?(?:"[^"\n]*"|'[^'\n]*'|\([^)\n]*\)))?[^\S\n]*$"#, in: text, with: "")
      text = replace(#"</?[A-Za-z][^\s>]*(?:\s(?:"[^"]*"|'[^']*'|[^>"'])*)?/?>"#, in: text, with: " ")
      text = replace(#"!?\[\]\([^)]*\)"#, in: text, with: "")
      if text == previous {
        break
      }
    }
    text = replace(#"!(?=\[[^\]\[]*\]\()"#, in: text, with: "")
    text = replace(#"`{2,}"#, in: text, with: "`")
    text = replace(#"`([^`]+)`"#, in: text, with: "$1")
    text = replace(#"\[([^\]\[]+)\]\([^)]+\)"#, in: text, with: "$1")
    text = replace(#"[*~>#]+"#, in: text, with: "")
    // A run flanked by Unicode letters or digits opens no emphasis in
    // CommonMark. Match it from the first underscore, or `foo__bar` loses one.
    text = replace(#"(?<![\p{L}\p{N}_])_+(?!_)|(?<!_)_+(?![\p{L}\p{N}_])"#, in: text, with: "")
    return replace(#"[^\S\n]+"#, in: text, with: " ").trimmingCharacters(in: .whitespacesAndNewlines)
  }

  private static func mentionName(key: String, slug: String, names: [String: String]) -> String {
    let lookup = key.contains("-") ? key.lowercased() : key
    let canonical = canonicalUUID(lookup)
    var name = stripInvisible(names[lookup] ?? names[canonical ?? ""] ?? "")
    name = replace(#"(?i)@?(?:(?:https?|ftps?)://|www\.)\S*"#, in: name, with: "")
      .trimmingCharacters(in: .whitespacesAndNewlines)
    let sameKey = slug.lowercased().replacingOccurrences(of: "-", with: "") == lookup.lowercased().replacingOccurrences(of: "-", with: "")
    let fallback = sameKey ? "" : slug
    let label = namesSomeone(name) ? name : namesSomeone(fallback) ? fallback : lookup == "all" ? "all" : ""
    return label.isEmpty ? "" : "@" + label
  }

  private static func canonicalUUID(_ key: String) -> String? {
    guard !matches(#"(?i)^[0-9a-f]{32}$"#, in: key).isEmpty else { return nil }
    let chars = Array(key.lowercased())
    return [0 ..< 8, 8 ..< 12, 12 ..< 16, 16 ..< 20, 20 ..< 32].map { String(chars[$0]) }.joined(separator: "-")
  }

  private static func namesSomeone(_ value: String) -> Bool {
    !matches(#"[^\p{P}\p{Z}\p{C}\s]"#, in: value).isEmpty
  }

  private static func stripInvisible(_ value: String) -> String {
    replace(invisible, in: replace(controls, in: value, with: ""), with: "")
  }

  private static func withoutAddresses(_ value: String) -> String {
    replacing(address, in: value) { match, source in trailingPunctuation(source.substring(with: match.range)) }
  }

  private static func trailingPunctuation(_ value: String) -> String {
    String(value.reversed().prefix { ".,;:!?)]}'\"".contains($0) }.reversed())
  }

  private static func capped(_ value: String) -> String {
    guard value.unicodeScalars.count > 128 else { return value }
    var result = ""
    var count = 0
    for character in value {
      let size = character.unicodeScalars.count
      guard count + size <= 127 else { break }
      result.append(character)
      count += size
    }
    result = result.trimmingCharacters(in: .whitespacesAndNewlines)
    return result.isEmpty ? "" : result + "…"
  }

  private static func expression(_ pattern: String) -> NSRegularExpression {
    do { return try NSRegularExpression(pattern: pattern) } catch {
      preconditionFailure("Invalid preview expression: \(error)")
    }
  }

  private static func matches(_ pattern: String, in value: String) -> [NSTextCheckingResult] {
    expression(pattern).matches(in: value, range: NSRange(value.startIndex..., in: value))
  }

  private static func replace(_ pattern: String, in value: String, with template: String) -> String {
    expression(pattern).stringByReplacingMatches(in: value, range: NSRange(value.startIndex..., in: value), withTemplate: template)
  }

  private static func replacing(_ pattern: String, in value: String, replacement: (NSTextCheckingResult, NSString) -> String) -> String {
    let source = value as NSString
    let output = NSMutableString(string: value)
    for match in matches(pattern, in: value).reversed() {
      output.replaceCharacters(in: match.range, with: replacement(match, source))
    }
    return output as String
  }
}

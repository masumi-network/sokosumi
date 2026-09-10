import Foundation

/// Display-only equivalent of packages/utils/src/linkify-bare-domains.ts.
/// Run before Markdown parsing so punctuation in URL paths stays literal.
struct MarkdownBareDomains {
  private let text: [Character]

  init(_ source: String) {
    text = Array(source)
  }

  func linkified() -> String {
    let links = inlineLinks()
    var result = ""
    var index = 0
    var linkIndex = 0
    while index < text.count {
      while linkIndex < links.count, links[linkIndex].upperBound <= index {
        linkIndex += 1
      }
      if linkIndex < links.count, links[linkIndex].contains(index) {
        let end = links[linkIndex].upperBound
        result += String(text[index ..< end])
        index = end
      } else if let end = protectedEnd(at: index) {
        result += String(text[index ..< end])
        index = end
      } else if let end = domainEnd(at: index) {
        let label = String(text[index ..< end])
        let escapedLabel = label.reduce(into: "") { value, character in
          if "\\[]*_~".contains(character) {
            value.append("\\")
          }
          value.append(character)
        }
        let href = ("https://" + label).replacingOccurrences(of: "\\", with: "\\\\")
          .replacingOccurrences(of: ")", with: "\\)")
        result += "[\(escapedLabel)](\(href))"
        index = end
      } else {
        result.append(text[index])
        index += 1
      }
    }
    return result
  }

  private func protectedEnd(at start: Int) -> Int? {
    let character = text[start]
    if character == "`" || character == "~" {
      var openingEnd = start
      while openingEnd < text.count, text[openingEnd] == character {
        openingEnd += 1
      }
      let length = openingEnd - start
      if length >= 3 || character == "`" {
        return codeEnd(start: start, openingEnd: openingEnd, character: character)
      }
    }
    if character == "<", let close = text[(start + 1)...].firstIndex(of: ">") {
      return close + 1
    }
    if text[start...].starts(with: Array("https://")) || text[start...].starts(with: Array("http://")) {
      var end = start
      while end < text.count, !Self.stops.contains(text[end]) {
        end += 1
      }
      while end > start, Self.trailing.contains(text[end - 1]) {
        end -= 1
      }
      return max(end, start + 1)
    }
    return nil
  }

  private func codeEnd(start: Int, openingEnd: Int, character: Character) -> Int {
    let length = openingEnd - start
    var index = openingEnd
    if length >= 3 {
      while index < text.count, text[index] != "\n" {
        index += 1
      }
      if index < text.count {
        index += 1
      }
    }
    while index < text.count {
      if length < 3, text[index] == "\n" {
        return start + 1
      }
      if text[index] == character {
        let closeStart = index
        while index < text.count, text[index] == character {
          index += 1
        }
        let closeLength = index - closeStart
        if length >= 3 ? closeLength >= length : closeLength == length {
          return index
        }
        index = closeStart + 1
      } else {
        index += 1
      }
    }
    return length >= 3 ? text.count : start + 1
  }

  private func domainEnd(at start: Int) -> Int? {
    guard Self.isLetter(text[start]) || Self.isDigit(text[start]) else { return nil }
    if start > 0 {
      let previous = text[start - 1]
      if Self.isHost(previous) || "@/:_".contains(previous) {
        return nil
      }
    }
    var end = start
    while end < text.count, Self.isHost(text[end]) {
      end += 1
    }
    if end < text.count, "/?#".contains(text[end]) {
      while end < text.count, !Self.stops.contains(text[end]) {
        end += 1
      }
    }
    while end > start, Self.trailing.contains(text[end - 1]) {
      end -= 1
    }
    let match = String(text[start ..< end])
    return isEligible(match) ? end : nil
  }

  private func isEligible(_ match: String) -> Bool {
    let hostEnd = match.firstIndex(where: { "/?#".contains($0) }) ?? match.endIndex
    let host = String(match[..<hostEnd])
    let rest = match[hostEnd...]
    guard !host.lowercased().hasPrefix("www.") else { return false }
    let labels = host.components(separatedBy: ".")
    guard labels.count >= 2,
          labels.allSatisfy({ !$0.isEmpty && $0.count <= 63 && !$0.hasPrefix("-") && !$0.hasSuffix("-") && $0.allSatisfy(Self.isLabel) }),
          let tld = labels.last?.lowercased(), Self.allowedTLDs.contains(tld),
          labels.dropLast().contains(where: { $0.contains(where: Self.isLetter) })
    else { return false }
    if rest.isEmpty || rest.hasPrefix("?") || rest.hasPrefix("#"), Self.fileExtensions.contains(tld) {
      return false
    }
    guard let url = URL(string: "https://" + match), url.host != nil else { return false }
    return true
  }

  /// Match the web's inline-link scanner, including optional double-quoted titles.
  private func inlineLinks() -> [Range<Int>] {
    var links: [Range<Int>] = []
    var cursor = 0
    while cursor < text.count, let open = text[cursor...].firstIndex(of: "[") {
      var labelEnd = open + 1
      while labelEnd < text.count, !"][\n".contains(text[labelEnd]) {
        labelEnd += 1
      }
      guard labelEnd > open + 1, labelEnd + 1 < text.count,
            text[labelEnd] == "]", text[labelEnd + 1] == "("
      else { cursor = open + 1
        continue
      }
      let urlStart = labelEnd + 2
      let end = linkDestinationEnd(start: urlStart)
      guard end > urlStart else { cursor = open + 1
        continue
      }
      var close = end
      if close < text.count, Self.whitespace.contains(text[close]) {
        while close < text.count, Self.whitespace.contains(text[close]) {
          close += 1
        }
        guard close < text.count, text[close] == "\"" else { cursor = close
          continue
        }
        close += 1
        while close < text.count, text[close] != "\"" {
          close += 1
        }
        if close == text.count {
          break
        }
        close += 1
      }
      if close < text.count, text[close] == ")" {
        links.append(open ..< close + 1)
        cursor = close + 1
      } else {
        cursor = max(open + 1, end)
      }
    }
    return links
  }

  private func linkDestinationEnd(start: Int) -> Int {
    var end = start
    while end < text.count {
      if text[end] == "\\" {
        if end + 1 == text.count {
          break
        }
        end += 2
      } else if text[end] == ")" || Self.whitespace.contains(text[end]) {
        break
      } else {
        end += 1
      }
    }
    return end
  }

  private static func isLetter(_ character: Character) -> Bool {
    ("a" ... "z").contains(character) || ("A" ... "Z").contains(character)
  }

  private static func isDigit(_ character: Character) -> Bool {
    ("0" ... "9").contains(character)
  }

  private static func isLabel(_ character: Character) -> Bool {
    isLetter(character) || isDigit(character) || character == "-"
  }

  private static func isHost(_ character: Character) -> Bool {
    isLabel(character) || character == "."
  }

  private static let stops = Set(" \t\n\r<>[]`'\"()")
  private static let trailing = Set(".,;:!?)}]")
  private static let whitespace = Set(" \t\n\r\u{0C}\u{0B}")
  private static let allowedTLDs = Set("com org net edu gov mil int info biz name pro app dev io ai co me tv cc fm ly to gg xyz online site tech store blog cloud shop club page web new one world digital media agency studio design tools systems solutions company email news today space live life games game video music photo photos gallery center global international network software technology services de uk us eu fr es it nl be at ch pl cz se no dk fi ie pt br mx ar cl jp cn kr in au nz za ca ru ua tr il sg hk tw id th vn ph my ae".split(separator: " ").map(String.init))
  private static let fileExtensions = Set("pdf png jpg jpeg gif webp svg bmp ico txt csv tsv md markdown doc docx xls xlsx ppt pptx zip rar 7z gz tar bz2 mp3 mp4 mov avi mkv webm wav ogg flac js jsx ts tsx mjs cjs json xml yml yaml toml css scss less html htm map wasm py rb go rs java kt swift c h cpp hpp cs php sh bash zsh sql db sqlite log lock env ini cfg conf exe dll so dylib bin dmg pkg deb rpm apk ipa".split(separator: " ").map(String.init))
}

import Foundation

/// Matches the web chat's raw emoji-only rule, before shortcode conversion.
/// A Swift Character is an extended grapheme cluster, including ZWJ families.
public func jumboEmojiCount(_ source: String) -> Int? {
  var count = 0
  for character in source {
    let scalars = character.unicodeScalars
    if scalars.allSatisfy({ $0.properties.isWhitespace && $0.value != 0x85 || $0.value == 0xFEFF }) {
      continue
    }
    let grapheme = String(character)
    guard grapheme.range(of: #"\p{Extended_Pictographic}|^\p{Regional_Indicator}{2}$|^[#*0-9]\uFE0F?\u20E3$"#,
                         options: .regularExpression) != nil
    else { return nil }
    count += 1
    if count > 23 {
      return nil
    }
  }
  return count > 0 ? count : nil
}

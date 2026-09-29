import SokosumiChat
import SwiftUI

/// Web's `composerCharacterCount` ("{count}/{max}"): the numbers print as plain digits, as an ICU simple
/// argument does, not with the locale's grouping separator. Red once over the limit.
struct ComposerCharacterCount: View {
  let content: ComposerContent

  var body: some View {
    Text(verbatim: "\(content.count)/\(ComposerContent.maximumLength)")
      .font(.caption)
      .foregroundStyle(content.isTooLong ? .red : .secondary)
      .accessibilityLabel("Message length: \(content.count) of \(ComposerContent.maximumLength)")
  }
}

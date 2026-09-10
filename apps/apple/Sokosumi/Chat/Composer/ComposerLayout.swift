import SwiftUI

/// Shared composer chrome; each platform supplies its native editor and actions.
struct ComposerLayout<Editor: View, Formatting: View, Actions: View>: View {
  @ViewBuilder let editor: Editor
  @ViewBuilder let formatting: Formatting
  @ViewBuilder let actions: Actions

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      formatting
        .padding(.horizontal, 10)
        .padding(.top, 8)
      editor
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
      HStack(spacing: 12) {
        actions
      }
      .padding(.horizontal, 12)
      .padding(.bottom, 10)
    }
    .background(.background, in: .rect(cornerRadius: 12))
    .overlay {
      RoundedRectangle(cornerRadius: 12).stroke(.quaternary)
    }
  }
}

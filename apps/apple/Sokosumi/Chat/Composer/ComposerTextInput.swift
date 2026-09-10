import SwiftUI

#if os(macOS)
  /// AppKit is isolated in MacComposerTextInput because SwiftUI onSubmit
  /// also fires when Return commits marked text.
  struct ComposerTextInput: View {
    @Binding var text: String
    let submit: () -> Bool
    var placeholder = "Message"

    var body: some View {
      MacComposerTextInput(text: $text, submit: submit, placeholder: placeholder)
        .padding(4)
        .background(.background, in: .rect(cornerRadius: 5))
        .overlay {
          RoundedRectangle(cornerRadius: 5).stroke(.quaternary)
        }
    }
  }
#endif

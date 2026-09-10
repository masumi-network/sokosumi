import SwiftUI

#if os(macOS)
  /// AppKit is isolated in MacComposerTextInput because SwiftUI onSubmit
  /// also fires when Return commits marked text.
  struct ComposerTextInput: View {
    @Binding var text: String
    @State private var emojiPickerRequest = 0
    let submit: () -> Bool
    var placeholder = "Message"

    var body: some View {
      HStack {
        MacComposerTextInput(text: $text, submit: submit, placeholder: placeholder, emojiPickerRequest: emojiPickerRequest)
        Button("Emoji", systemImage: "face.smiling") {
          emojiPickerRequest += 1
        }
        .labelStyle(.iconOnly)
        .buttonStyle(.borderless)
        .help("Emoji & Symbols")
      }
      .padding(4)
      .background(.background, in: .rect(cornerRadius: 5))
      .overlay {
        RoundedRectangle(cornerRadius: 5).stroke(.quaternary)
      }
    }
  }
#endif

import SokosumiChat
import SwiftUI

#if os(macOS)
  /// AppKit is isolated in MacComposerTextInput because SwiftUI onSubmit
  /// also fires when Return commits marked text.
  struct ComposerTextInput: View {
    @Binding var text: String
    @State private var emojiPickerRequest = 0
    @StateObject private var commands = MacComposerCommands()
    @State private var toolbarVisible = ComposerPreferences().toolbarVisible
    let submit: () -> Bool
    var placeholder = "Message"
    var canSend = true
    var content = ComposerContent("")
    var channels: [ComposerChannel] = []
    var mentions: [ComposerMention] = []

    var body: some View {
      ComposerLayout {
        MacComposerTextInput(text: $text, submit: submit, placeholder: placeholder, emojiPickerRequest: emojiPickerRequest, commands: commands, channels: channels, mentions: mentions)
      } formatting: {
        if toolbarVisible {
          ComposerFormatToolbar(commands: commands)
        }
      } actions: {
        ComposerToolbarButton(title: toolbarVisible ? "Hide formatting" : "Show formatting", symbol: "textformat", selected: toolbarVisible) {
          toolbarVisible.toggle()
          ComposerPreferences().toolbarVisible = toolbarVisible
        }
        ComposerToolbarButton(title: "Emoji & Symbols", symbol: "face.smiling") {
          emojiPickerRequest += 1
        }
        .accessibilityIdentifier("composer.emojiPicker")
        if !mentions.isEmpty {
          ComposerToolbarButton(title: "Mention", symbol: "at") {
            commands.beginMention()
          }
          .accessibilityIdentifier("composer.mentionPicker")
        }
        Spacer(minLength: 8)
        if content.showsCounter {
          Text("\(content.count)/\(ComposerContent.maximumLength)")
            .font(.caption)
            .foregroundStyle(content.isTooLong ? .red : .secondary)
            .accessibilityLabel("Message length: \(content.count) of \(ComposerContent.maximumLength)")
        }
        Button("Send", systemImage: "arrow.up") { _ = submit() }
          .labelStyle(.iconOnly)
          .buttonStyle(.borderedProminent)
          .buttonBorderShape(.circle)
          .disabled(!canSend)
          .help("Send message")
      }
      .sheet(item: $commands.linkEditor) { editor in
        ComposerLinkEditor(text: editor.text, url: editor.url) { text, url in
          commands.saveLink(editor, text: text, url: url)
        }
      }
    }
  }
#endif

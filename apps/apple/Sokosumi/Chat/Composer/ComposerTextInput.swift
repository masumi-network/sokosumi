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
    var attach: (() -> Void)?
    var attachFromDrive: (() -> Void)?
    var attachFiles: (([URL]) -> Void)?
    var attachImage: ((Data) -> Void)?

    var body: some View {
      ComposerLayout {
        MacComposerTextInput(text: $text, submit: submit, placeholder: placeholder, emojiPickerRequest: emojiPickerRequest, commands: commands, channels: channels, mentions: mentions, attachFiles: attachFiles, attachImage: attachImage)
      } formatting: {
        if toolbarVisible {
          ComposerFormatToolbar(commands: commands)
        }
      } actions: {
        if let attach {
          Menu {
            Button("Upload from device", systemImage: "square.and.arrow.up", action: attach)
            if let attachFromDrive {
              Button("From Files", systemImage: "externaldrive", action: attachFromDrive)
            }
          } label: {
            Image(systemName: "paperclip")
          }
          .menuStyle(.borderlessButton)
          .fixedSize()
          .help("Attach files")
          .accessibilityLabel("Attach files")
        }
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
      .overlay(alignment: .topLeading) {
        if !commands.mentionOptions.isEmpty || !commands.emojiOptions.isEmpty || !commands.channelOptions.isEmpty {
          ComposerSuggestionsView(channels: commands.channelOptions, acceptChannel: commands.acceptChannel, mentions: commands.mentionOptions, emojis: commands.emojiOptions, acceptEmoji: commands.acceptEmoji, selectedID: $commands.selectedSuggestionID, accept: commands.acceptMention)
        }
      }
      .sheet(item: $commands.linkEditor) { editor in
        ComposerLinkEditor(text: editor.text, url: editor.url) { text, url in
          commands.saveLink(editor, text: text, url: url)
        }
      }
    }
  }
#endif

#if os(macOS)
  import CoreAPI
  import SokosumiAuth
  import SokosumiChat
  import SokosumiWorkspace
  import SwiftUI

  /// Web's inline `MessageEditComposer`: no Save or Cancel button (Return saves, Escape cancels), the field
  /// dimmed while a save is in flight, and from 9,500 units the count under it, beside a hint once over the limit.
  struct MessageEditComposer: View {
    @EnvironmentObject private var workspaces: WorkspaceState
    @EnvironmentObject private var auth: AuthState
    @ObservedObject var editing: MessageEditing

    var body: some View {
      let content = editing.content
      VStack(alignment: .leading, spacing: 4) {
        ComposerTextInput(text: $editing.draft, submit: commit,
                          cancelEdit: editing.cancel, onBlur: { [sourceID = editing.source?.id] in
                            guard sourceID == editing.source?.id else { return }
                            cancelUnchanged()
                          },
                          placeholder: "Edit message",
                          channels: workspaces.composerChannels, mentions: workspaces.composerMentions)
          .disabled(editing.isSaving)
          .opacity(editing.isSaving ? 0.5 : 1)
        if let error = editing.errorMessage {
          Text(error).font(.caption).foregroundStyle(.red)
        }
        if content.showsCounter {
          HStack(alignment: .firstTextBaseline, spacing: 8) {
            if content.isTooLong {
              Text("Too long to send as text").font(.caption).foregroundStyle(.red)
            }
            Spacer(minLength: 0)
            ComposerCharacterCount(content: content)
          }
        }
      }
    }

    private func cancelUnchanged() {
      guard let source = editing.source, editing.content.text == ComposerContent(source.content).text else { return }
      editing.cancel()
    }

    private func commit() -> Bool {
      guard !editing.isSaving else { return false }
      if editing.canSave {
        Task { await workspaces.saveMessageEdit(auth: auth) }
      } else if !editing.content.isTooLong {
        editing.cancel()
      }
      return false
    }
  }
#endif

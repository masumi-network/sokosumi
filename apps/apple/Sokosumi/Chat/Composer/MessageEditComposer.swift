#if os(macOS)
  import CoreAPI
  import SokosumiAuth
  import SokosumiChat
  import SokosumiWorkspace
  import SwiftUI

  struct MessageEditComposer: View {
    @EnvironmentObject private var workspaces: WorkspaceState
    @EnvironmentObject private var auth: AuthState
    @ObservedObject var editing: MessageEditing

    var body: some View {
      VStack(alignment: .leading, spacing: 4) {
        ComposerTextInput(text: $editing.draft, submit: commit,
                          cancelEdit: editing.cancel, onBlur: { [sourceID = editing.source?.id] in
                            guard sourceID == editing.source?.id else { return }
                            cancelUnchanged()
                          },
                          placeholder: "Edit message", canSend: editing.canSave, content: editing.content,
                          channels: workspaces.composerChannels, mentions: workspaces.composerMentions)
          .disabled(editing.isSaving)
        if let error = editing.errorMessage {
          Text(error).font(.caption).foregroundStyle(.red)
        } else if editing.content.isTooLong {
          Text("Message exceeds the 10,000-character limit.").font(.caption).foregroundStyle(.red)
        }
      }
      .accessibilityLabel("Edit message")
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

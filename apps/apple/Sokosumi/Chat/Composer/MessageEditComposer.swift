#if os(macOS)
  import CoreAPI
  import SokosumiAuth
  import SokosumiChat
  import SokosumiWorkspace
  import SwiftUI

  /// Web's inline `MessageEditComposer`: Return or Save commits, Escape or Cancel cancels, the field dims while
  /// a save is in flight, and from 9,500 units the count sits under it, beside a hint once over the limit. Save
  /// is enabled only when the commit would save (`MessageEditCommit`). Where web has a Cancel and Save button row
  /// under the field, compact controls sit beside it (`MessageEditControls`).
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
                          placeholder: "Edit message", canSend: editing.canSave,
                          channels: workspaces.composerChannels, mentions: workspaces.composerMentions)
          .disabled(editing.isSaving)
          .opacity(editing.isSaving ? 0.5 : 1)
        if let error = editing.errorMessage {
          Text(error).font(.caption).foregroundStyle(.red)
        }
        if content.showsCounter {
          HStack(alignment: .firstTextBaseline, spacing: 8) {
            if content.isTooLong {
              ComposerTooLongHint()
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
      switch editing.commitAction {
      case .save: Task { await workspaces.saveMessageEdit(auth: auth) }
      case .cancel: editing.cancel()
      case .keepEditing: break
      }
      return false
    }
  }
#endif

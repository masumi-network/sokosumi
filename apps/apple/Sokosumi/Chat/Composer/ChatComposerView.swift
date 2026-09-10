import CoreAPI
import SokosumiAuth
import SokosumiChat
import SokosumiWorkspace
import SwiftUI

#if os(macOS)
  /// Owns typing state so edits do not invalidate the transcript. The parent
  /// gives each account/workspace/room a distinct identity before loading its draft.
  struct ChatComposerView: View {
    @EnvironmentObject private var workspaces: WorkspaceState
    @EnvironmentObject private var auth: AuthState
    @State private var draft: String

    private let savedDraft: SavedComposeDraft
    private let roomId: String
    private let parentMessageId: String?
    private let onAccepted: (() -> Void)?

    init(userId: String, organizationId: String?, roomId: String, parentMessageId: String? = nil, onAccepted: (() -> Void)? = nil) {
      self.onAccepted = onAccepted
      self.roomId = roomId
      self.parentMessageId = parentMessageId
      let savedDraft = SavedComposeDraft(userId: userId, organizationId: organizationId, roomId: roomId, parentMessageId: parentMessageId)
      self.savedDraft = savedDraft
      _draft = State(initialValue: savedDraft.load())
    }

    private var composerPlaceholder: String {
      if parentMessageId != nil {
        return "Reply to thread"
      }
      guard let room = workspaces.rooms.first(where: { $0.id == roomId }) else { return "Message" }
      return "Message \(roomDisplayName(room, currentUserId: workspaces.currentUserId))"
    }

    private var preparedContent: ComposerContent {
      ComposerContent(ComposerEmoji.preparingToSend(draft))
    }

    private var canSend: Bool {
      preparedContent.canSend
        && !workspaces.directStream.isBusy
        && (parentMessageId != nil || !workspaces.transcriptLoading)
        && workspaces.transcriptRoomId == roomId
        && (parentMessageId == nil || workspaces.thread.parent?.id == parentMessageId)
    }

    var body: some View {
      let content = preparedContent
      HStack {
        ComposerTextInput(text: Binding(
          get: { draft },
          set: { text in
            draft = text
            savedDraft.save(text)
          }
        ), submit: sendDraft, placeholder: composerPlaceholder)
        if content.showsCounter {
          Text("\(content.count)/\(ComposerContent.maximumLength)")
            .font(.caption)
            .foregroundStyle(content.isTooLong ? .red : .secondary)
            .accessibilityLabel("Message length: \(content.count) of \(ComposerContent.maximumLength)")
        }
        Button("Send") { sendDraft() }
          .disabled(!canSend)
      }
      .padding(8)
      .onChange(of: workspaces.directStream.restoredDraft, initial: true) { _, _ in
        guard let text = workspaces.directStream.restoredDraft(for: roomId, parentMessageId: parentMessageId) else { return }
        draft = savedDraft.restoreFailedSend(text, preserving: draft)
        Task { @MainActor in
          workspaces.directStream.consumeRestoredDraft()
        }
      }
    }

    @discardableResult
    private func sendDraft() -> Bool {
      guard canSend else { return false }
      let content = ComposerEmoji.preparingToSend(draft)
      let accepted = parentMessageId == nil
        ? workspaces.sendMessage(content, auth: auth)
        : workspaces.sendThreadReply(content, auth: auth)
      guard accepted else { return false }
      draft = ""
      savedDraft.save("")
      onAccepted?()
      return true
    }
  }

#endif

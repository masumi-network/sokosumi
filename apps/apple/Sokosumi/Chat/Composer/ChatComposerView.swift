import CoreAPI
import SokosumiAuth
import SokosumiChat
import SokosumiWorkspace
import SwiftUI
import UniformTypeIdentifiers

#if os(macOS)
  /// Owns typing state so edits do not invalidate the transcript. The parent
  /// gives each account/workspace/room a distinct identity before loading its draft.
  struct ChatComposerView: View {
    @EnvironmentObject private var workspaces: WorkspaceState
    @EnvironmentObject private var auth: AuthState
    @State private var draft: String
    @State private var filePickerPresented = false
    @StateObject private var uploads: ComposeUploads

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
      _uploads = StateObject(wrappedValue: ComposeUploads(savedDraft: savedDraft))
    }

    private var composerPlaceholder: String {
      if parentMessageId != nil {
        return "Reply to thread"
      }
      guard let room = workspaces.rooms.first(where: { $0.id == roomId }) else { return "Message" }
      return "Message \(roomDisplayName(room, currentUserId: workspaces.currentUserId))"
    }

    private var preparedContent: ComposerContent {
      ComposerContent(ComposeAttachment.message(ComposerEmoji.preparingToSend(draft), attachments: uploads.attachments))
    }

    private var canSend: Bool {
      preparedContent.canSend
        && uploads.uploadingName == nil
        && (uploads.attachments.isEmpty || workspaces.canAttachFiles(roomId: roomId))
        && !workspaces.directStream.isBusy
        && (parentMessageId != nil || !workspaces.transcriptLoading)
        && workspaces.transcriptRoomId == roomId
        && (parentMessageId == nil || workspaces.thread.parent?.id == parentMessageId)
    }

    var body: some View {
      VStack(alignment: .leading, spacing: 6) {
        ComposerAttachmentsView(uploads: uploads)
        editor
        if preparedContent.isTooLong, !draft.isEmpty, workspaces.canAttachFiles(roomId: roomId) {
          Button("Attach message as Markdown file") { attachOverflow() }
            .disabled(uploads.uploadingName != nil)
        }
      }
      .fileImporter(isPresented: $filePickerPresented, allowedContentTypes: [.data], allowsMultipleSelection: true) { result in
        switch result {
        case let .success(files): attachFiles(files)
        case let .failure(error): uploads.report(error)
        }
      }
      .dropDestination(for: URL.self) { files, _ in
        guard workspaces.canAttachFiles(roomId: roomId), uploads.uploadingName == nil else { return false }
        attachFiles(files)
        return true
      }
      .onDisappear { Task { @MainActor in uploads.cancel() } }
      .padding(8)
      .onChange(of: workspaces.directStream.restoredDraft, initial: true) { _, _ in
        guard let text = workspaces.directStream.restoredDraft(for: roomId, parentMessageId: parentMessageId) else { return }
        draft = savedDraft.restoreFailedSend(text, preserving: draft)
        Task { @MainActor in
          workspaces.directStream.consumeRestoredDraft()
        }
      }
    }

    private var editor: some View {
      var input = ComposerTextInput(text: Binding(
        get: { draft },
        set: { text in
          draft = text
          savedDraft.save(text)
        }
      ), submit: sendDraft, placeholder: composerPlaceholder, canSend: canSend, content: preparedContent, channels: workspaces.composerChannels, mentions: workspaces.composerMentions)
      if workspaces.canAttachFiles(roomId: roomId) {
        input.attach = { filePickerPresented = true }
        input.attachFiles = { files in attachFiles(files) }
        input.attachImage = { data in attachImage(data) }
      }
      return input
    }

    private func attachFiles(_ files: [URL]) {
      guard workspaces.canAttachFiles(roomId: roomId) else { return }
      uploads.upload(files) { file in
        try await workspaces.uploadAttachment(file, roomId: roomId, auth: auth)
      }
    }

    private func attachImage(_ data: Data) {
      attachTemporary(data, filename: "image.png")
    }

    private func attachOverflow() {
      let text = draft
      attachTemporary(Data(text.utf8), filename: "message.md") {
        // Do not discard typing added while the upload was running.
        if draft == text {
          draft = ""
          savedDraft.save("")
        }
      }
    }

    private func attachTemporary(_ data: Data, filename: String, completed: (() -> Void)? = nil) {
      guard workspaces.canAttachFiles(roomId: roomId), uploads.uploadingName == nil else { return }
      uploads.upload(data, filename: filename, using: { file in
        try await workspaces.uploadAttachment(file, roomId: roomId, auth: auth)
      }, completed: completed)
    }

    @discardableResult
    private func sendDraft() -> Bool {
      guard canSend else { return false }
      let content = preparedContent.text
      let accepted = parentMessageId == nil
        ? workspaces.sendMessage(content, auth: auth)
        : workspaces.sendThreadReply(content, auth: auth)
      guard accepted else { return false }
      draft = ""
      savedDraft.save("")
      uploads.clear()
      onAccepted?()
      return true
    }
  }

#endif

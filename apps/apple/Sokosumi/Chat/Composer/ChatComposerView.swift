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
    @Binding var pendingQuote: Components.Schemas.ChatRoomMessageQuote?
    @State private var draft: String
    @State private var filePickerPresented = false
    @State private var drivePickerPresented = false
    // The pasted link the pending quote replaced, so removing that quote can
    // put the link back as plain text.
    @State private var quotedLink: QuotedLink?
    @State private var insertion: ComposerInsertion?
    @State private var pasteGeneration = 0
    @StateObject private var uploads: ComposeUploads

    /// A pasted Message link that became the pending quote.
    private struct QuotedLink {
      let messageId: String
      let text: String
    }

    private let savedDraft: SavedComposeDraft
    private let quoteFocusRequest: String?
    private let roomId: String
    private let parentMessageId: String?
    private let onAccepted: (() -> Void)?

    init(userId: String, organizationId: String?, roomId: String, parentMessageId: String? = nil, pendingQuote: Binding<Components.Schemas.ChatRoomMessageQuote?> = .constant(nil), quoteFocusRequest: String? = nil, onAccepted: (() -> Void)? = nil) {
      _pendingQuote = pendingQuote
      self.quoteFocusRequest = quoteFocusRequest
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

    /// The coworker 1:1 stream needs words to answer, so a quote cannot be the
    /// whole message there.
    private var requiresBody: Bool {
      workspaces.directStream.roomId == roomId
    }

    private var canSend: Bool {
      preparedContent.canSend(quoted: pendingQuote != nil && !requiresBody)
        && uploads.uploadingName == nil
        && (uploads.attachments.isEmpty || workspaces.canAttachFiles(roomId: roomId))
        && !workspaces.directStream.isBusy
        && (parentMessageId != nil || !workspaces.transcriptLoading)
        && workspaces.transcriptRoomId == roomId
        && (parentMessageId == nil || workspaces.thread.parent?.id == parentMessageId)
    }

    var body: some View {
      VStack(alignment: .leading, spacing: 6) {
        if let pendingQuote {
          MessageQuoteView(quote: pendingQuote, room: workspaces.rooms.first { $0.id == roomId }, channels: workspaces.composerChannels, dismiss: dismissPendingQuote)
        }
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
      .sheet(isPresented: $drivePickerPresented) {
        DriveFilePickerView(load: { folder, query in
          try await workspaces.driveItems(folder: folder, query: query, roomId: roomId, auth: auth)
        }, select: { attachment in
          guard workspaces.canAttachFiles(roomId: roomId) else { return }
          uploads.add(attachment)
        })
      }
      .dropDestination(for: URL.self) { files, _ in
        guard workspaces.canAttachFiles(roomId: roomId), uploads.uploadingName == nil else { return false }
        attachFiles(files)
        return true
      }
      .onDisappear { Task { @MainActor in uploads.cancel() } }
      .padding([.horizontal, .bottom], 8)
      .background(.background)
      .onChange(of: workspaces.directStream.restoredDraft, initial: true) { _, _ in
        guard let text = workspaces.directStream.restoredDraft(for: roomId, parentMessageId: parentMessageId) else { return }
        draft = savedDraft.restoreFailedSend(text, preserving: draft)
        if pendingQuote == nil {
          pendingQuote = workspaces.directStream.restoredQuote
        }
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
      ), submit: sendDraft, focusRequest: quoteFocusRequest, placeholder: composerPlaceholder, canSend: canSend, content: preparedContent, channels: workspaces.composerChannels, mentions: workspaces.composerMentions)
      input.onPaste = { paste in quotePastedLink(paste) }
      input.insertion = insertion
      if workspaces.canAttachFiles(roomId: roomId) {
        input.attach = { filePickerPresented = true }
        input.attachFromDrive = { drivePickerPresented = true }
        input.attachFiles = { files in attachFiles(files) }
        input.attachImage = { data in attachImage(data) }
      }
      return input
    }

    /// A paste that is exactly one Message link the sender may quote here
    /// becomes the pending quote, replacing the pasted text.
    private func quotePastedLink(_ paste: ComposerTextPaste) {
      pasteGeneration += 1
      let generation = pasteGeneration
      // One quote per message: never swap a quote the sender already chose.
      guard pendingQuote == nil else { return }
      Task { @MainActor in
        guard let quote = await workspaces.messageLinkQuote(pasted: paste.text, roomId: roomId, webBaseURL: CoreSettings.webBaseURL, auth: auth),
              generation == pasteGeneration, pendingQuote == nil, workspaces.transcriptRoomId == roomId,
              // Nothing to swap once the link was edited away.
              paste.remove() else { return }
        pendingQuote = quote
        quotedLink = QuotedLink(messageId: quote.messageId, text: paste.text)
      }
    }

    private func dismissPendingQuote() {
      if let quotedLink, quotedLink.messageId == pendingQuote?.messageId {
        insertion = ComposerInsertion(text: draft.isEmpty ? quotedLink.text : " " + quotedLink.text)
      }
      quotedLink = nil
      pendingQuote = nil
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
        ? workspaces.sendMessage(content, attachments: uploads.attachments, quote: pendingQuote, auth: auth)
        : workspaces.sendThreadReply(content, attachments: uploads.attachments, quote: pendingQuote, auth: auth)
      guard accepted else { return false }
      pasteGeneration += 1
      quotedLink = nil
      pendingQuote = nil
      draft = ""
      savedDraft.save("")
      uploads.clear()
      onAccepted?()
      return true
    }
  }

#endif

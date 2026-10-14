import CoreAPI
import SokosumiChat
import SwiftUI

#if os(macOS)

  /// Delivery mark in the header or continuation gutter; retains the header clock until needed.
  private struct DeliveryFeedback: View {
    let pendingSince: Date?
    let sentAt: Date?
    var timestamp: Date?
    @Environment(\.timeFormat) private var timeFormat
    @State private var showSending = false

    var body: some View {
      HStack(spacing: 4) {
        if pendingSince != nil, showSending {
          ProgressView().controlSize(.mini)
            .accessibilityLabel("Sending")
            .help("Sending…")
        } else if sentAt != nil {
          Image(systemName: "checkmark")
            .accessibilityLabel("Sent")
            .help("Sent")
        } else if let timestamp {
          // Wall-clock time in the local timezone, like web `formatMessageTime`.
          Text(timeFormat.time(timestamp))
        }
      }
      .font(.caption)
      .foregroundStyle(.secondary)
      .task(id: pendingSince) {
        showSending = false
        guard let pendingSince else { return }
        let remaining = max(0, 0.5 - Date().timeIntervalSince(pendingSince))
        do { try await Task.sleep(for: .seconds(remaining)) } catch { return }
        showSending = true
      }
    }
  }

  /// Whether the reader is scrolling the room or Thread transcript around a row (M8). An object rather than an
  /// environment value: only a row under the pointer reads it, so a scroll starting or ending re-evaluates that row
  /// alone, where a changed environment value reached every realized row.
  @MainActor @Observable final class TranscriptScrollActivity {
    var isScrolling = false
    /// Older-page insertion waits for native idle, including programmatic animations.
    var isAtRest = true

    func update(for phase: ScrollPhase) {
      let scrolling = phase == .interacting || phase == .decelerating || phase == .tracking
      if isScrolling != scrolling {
        isScrolling = scrolling
      }
      let atRest = phase == .idle
      if isAtRest != atRest {
        isAtRest = atRest
      }
    }
  }

  extension EnvironmentValues {
    @Entry var transcriptScrollActivity: TranscriptScrollActivity?
    /// How long the pointer rests on a row before its hover fill and action bar show (M8).
    @Entry var messageHoverDelay: Duration = .milliseconds(200)
  }

  struct MessageRowView: View {
    /// Avatar edge: web uses 32px, but that reads oversized next to the
    /// native sidebar (28pt "me" avatar), so the transcript matches in-app.
    static let avatarDiameter: CGFloat = 28

    var channels: [ComposerChannel] = []
    var room: Components.Schemas.ChatRoom?
    var preparedDocument: MessageMarkdown?
    let message: Components.Schemas.ChatRoomMessage
    /// What the transcript decided for this message: its actions and the parts it draws.
    let row: MessageRow
    let outbound: OutboundShell?
    var sentAt: Date?
    /// The transcript's answer to this row's actions (`TranscriptRowActions.perform`): nil from a local action, the
    /// request's task otherwise. `row.actions` decides which the row offers.
    var perform: ((MessageRowAction) -> Task<Void, any Error>?)?
    /// Mentioner-only retry of a failed coworker mention shell.
    var canRetryMention = false
    /// The mark a jump left on this row, while it lasts (row 25b1).
    var jumpMark: JumpMark?
    var isPinned = false
    var isUpdatingPin = false
    var editing: MessageEditing?
    /// Send to yourself, offered where `row.actions.canSendToSelf`.
    var onSendToSelf: (() async throws -> Components.Schemas.ChatRoomMessage)?
    /// The Soko Bot turn's useful / not useful thumbs, on a row that carries them (row 38b).
    var sokoBotFeedback: SokoBotFeedback?
    /// Reads the message's recorded result cards (row 38e1); the room and the Thread pass it.
    var loadResultPreviews: (() async throws -> [Components.Schemas.ChatResultPreview])?
    var horizontalInset: CGFloat = 0
    var streamThinking = false
    /// Who has read this far: set on the room transcript's newest message only (row 31b1).
    var seenBy: SeenBy?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.openURL) private var openURL
    @Environment(\.timeFormat) private var timeFormat
    @Environment(\.transcriptScrollActivity) private var scrollActivity
    @Environment(\.messageHoverDelay) private var hoverDelay
    @State private var quickReactions = ReactionEmojiHistory.defaultQuickReactions
    @State private var showsReactionPicker = false
    @State private var confirmsDeletion = false
    @State private var isDeleting = false
    @State private var isRetryingMention = false
    @State private var isSendingToSelf = false
    @State private var sentToSelf: Components.Schemas.ChatRoomMessage?
    @State private var failure: FailureAlert?
    @State private var isHovered = false
    /// The pointer has stayed on the row for `hoverDelay` while the transcript was still (M8).
    @State private var hoverRested = false
    @State private var isReplyHovered = false
    @State private var hoveredAction: MessageAction?
    @ScaledMetric(relativeTo: .body) private var replyActionHeight: CGFloat = 28
    @ScaledMetric(relativeTo: .callout) private var actionIconSize: CGFloat = 16
    @FocusState private var focusedAction: MessageAction?

    private enum MessageAction: Hashable {
      case quote, reply, more, react
      case quickReaction(Int)
      case feedback(useful: Bool)
    }

    /// What failed: pin, reaction, delete, mention retry, and send-to-self share one OK-dismiss alert.
    private enum Failure {
      case reaction, delete, retryMention, sendToSelf, pin

      var title: String {
        switch self {
        case .reaction: "Couldn’t update reaction"
        case .delete: "Couldn’t delete message"
        case .retryMention: "Couldn’t retry the mention"
        case .sendToSelf: "Couldn’t send to yourself"
        case .pin: "Couldn’t update pin"
        }
      }
    }

    private struct FailureAlert {
      let failure: Failure
      let message: String
    }

    private var transcriptIsScrolling: Bool {
      scrollActivity?.isScrolling == true
    }

    /// M8: the hover fill and action bar wait for a resting pointer and never ride a scroll past it. Web delays
    /// the bar by the same 200 ms (`MESSAGE_ACTIONS_PILL_REVEAL_DELAY_CLASS`).
    private var showsHoverChrome: Bool {
      (isHovered || isReplyHovered) && hoverRested && !transcriptIsScrolling
    }

    /// Keyboard focus and the open picker show the bar at once.
    private var showsActions: Bool {
      showsHoverChrome || focusedAction != nil || showsReactionPicker
    }

    /// The bar exists only while the pointer is on the row or the bar shows, hidden until it does: a hidden bar on
    /// every realized row cost SwiftUI layout and hit testing on every scroll step (M6). The keyboard and VoiceOver
    /// reach every action through the row's menu and accessibility actions (M7).
    private var buildsActionBar: Bool {
      isHovered || isReplyHovered || showsActions
    }

    private var isContinuation: Bool {
      row.isContinuation
    }

    private var reactionAction: ((String) -> Void)? {
      guard row.actions.canReact else { return nil }
      return { emoji in toggleReaction(emoji) }
    }

    /// Runs `action` and awaits its request, if it starts one.
    private func run(_ action: MessageRowAction) async throws {
      try await perform?(action)?.value
    }

    private func fail(_ failure: Failure, _ error: any Error) {
      self.failure = FailureAlert(failure: failure, message: friendlyMessage(for: error))
    }

    private func toggleReaction(_ emoji: String) {
      guard perform != nil else { return }
      Task { @MainActor in
        do {
          try await run(.toggleReaction(emoji))
        } catch {
          fail(.reaction, error)
        }
      }
    }

    private func deleteMessage() {
      guard !isDeleting, perform != nil else { return }
      isDeleting = true
      Task { @MainActor in
        defer { isDeleting = false }
        do { try await run(.delete) } catch {
          fail(.delete, error)
        }
      }
    }

    /// Retry state lives on the row: optimistic thinking unmounts the failed
    /// shell, and a child alert would die with it.
    private func retryMention() {
      guard !isRetryingMention, canRetryMention else { return }
      isRetryingMention = true
      Task { @MainActor in
        defer { isRetryingMention = false }
        do { try await run(.retryMention) } catch {
          fail(.retryMention, error)
        }
      }
    }

    private var mentionRetryHandler: (() -> Void)? {
      guard canRetryMention, perform != nil else { return nil }
      return retryMention
    }

    private var failedMentionView: some View {
      CoworkerMentionFailedView(onRetry: mentionRetryHandler, isRetrying: isRetryingMention)
    }

    private var pinnedLabel: some View {
      Label {
        Text("Pinned", tableName: "ChatPins", comment: "A channel message that is pinned.")
      } icon: {
        Image(systemName: "pin.fill")
      }
      .font(.caption)
      .foregroundStyle(.secondary)
      .fixedSize()
    }

    var body: some View {
      HStack(alignment: .top, spacing: 14) {
        if isContinuation {
          DeliveryFeedback(pendingSince: pendingSince, sentAt: sentAt)
            .frame(width: Self.avatarDiameter)
            .frame(minHeight: 16)
        } else {
          ParticipantProfileButton(sender: message.sender) { avatarView }
        }
        VStack(alignment: .leading, spacing: 6) {
          if isContinuation, row.showsPinnedLabel(isPinned: isPinned) {
            pinnedLabel
          }
          if !isContinuation {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
              ParticipantProfileButton(sender: message.sender) {
                Text(messageSenderName(message.sender))
                  .fontWeight(.semibold)
                  .foregroundStyle(.primary)
                  .lineLimit(1)
              }
              DeliveryFeedback(pendingSince: pendingSince, sentAt: sentAt,
                               timestamp: message.createdAt)
              if row.isEdited {
                Text("Edited").help(message.editedAt.map { timeFormat.edited($0) } ?? "")
                  .font(.caption)
                  .foregroundStyle(.secondary)
              }
              if row.showsPinnedLabel(isPinned: isPinned) {
                pinnedLabel
              }
            }
          }
          ForEach(row.body) { part in
            bodyPart(part)
          }
          if !row.skills.isEmpty {
            MessageSkillChipsView(skills: row.skills)
          }
          ForEach(row.unfurls, id: \.url) { preview in
            MessageUnfurlView(preview: preview, remove: row.actions.canEdit && perform != nil ? { try await run(.removeUnfurl(preview.url)) } : nil)
              .id(preview.url + (preview.imageUrl ?? ""))
          }
          if let loadResultPreviews, !row.resultPreviewIds.isEmpty {
            MessageResultPreviewsView(descriptorIds: row.resultPreviewIds, footer: row.sokoBotFooter, load: loadResultPreviews,
                                      select: perform.map { _ in { try await run(.selectProject(previewId: $0, projectId: $1)) } },
                                      resolveDecision: perform.map { _ in { try await run(.resolveDecision($0, $1)) } })
          } else if let sokoBotFooter = row.sokoBotFooter {
            SokoBotMessageFooterView(turn: sokoBotFooter)
          }
          if isContinuation, row.isEdited {
            Text("Edited").help(message.editedAt.map { timeFormat.edited($0) } ?? "").font(.caption).foregroundStyle(.secondary)
          }
          if row.showsReactions {
            MessageReactionsView(reactions: message.reactions, toggle: reactionAction)
          }
          if let perform, let bar = row.threadReplyBar {
            ThreadReplyBarButton(bar: bar) { _ = perform(.reply) }
              .padding(.top, 4)
          }
          if let outbound, outbound.status == .failed {
            if let error = outbound.errorMessage, !error.isEmpty {
              Text(error)
                .font(.caption)
                .foregroundStyle(.secondary)
            }
            HStack(spacing: 12) {
              if let perform {
                Button("Retry") { _ = perform(.retrySend) }
                Button("Remove", role: .destructive) { _ = perform(.removeSend) }
              }
            }
            .buttonStyle(.borderless)
            .font(.caption)
          }
        }
        // The faces sit in the corner, out of the text flow; the column gives up their width so no line runs under
        // them. A newest body ending in attachments keeps their height under it instead, from the first layout, with
        // the 4 pt they keep from the row's edge between them and the attachment.
        .padding(.trailing, row.keepsSeenByCornerClear ? 0 : seenBy.map { SeenByFaces.width(for: $0) + 8 } ?? 0)
        .padding(.bottom, row.keepsSeenByCornerClear ? SeenByFaces.faceDiameter + 4 : 0)
        .frame(maxWidth: .infinity, alignment: .leading)
      }
      .padding(.vertical, 4)
      .padding(.horizontal, horizontalInset)
      .contentShape(.rect)
      .background {
        if let jumpMark {
          JumpMarkBackground(mark: jumpMark)
        } else if showsHoverChrome, row.showsActionBar {
          Color.primary.opacity(0.04)
        }
      }
      .overlay(alignment: .bottomTrailing) {
        if let seenBy {
          SeenByButton(seenBy: seenBy)
            .padding(.trailing, horizontalInset)
            .padding(.bottom, 4)
        }
      }
      .overlay(alignment: .topTrailing) {
        if row.showsActionBar, buildsActionBar {
          ViewThatFits(in: .horizontal) {
            actionControls(compact: false)
            actionControls(compact: true)
          }
          .popover(isPresented: $showsReactionPicker, attachmentAnchor: .rect(.bounds), arrowEdge: .bottom) {
            ReactionEmojiPicker { emoji in
              showsReactionPicker = false
              toggleReaction(emoji)
            }
          }
          .padding(3)
          .background(.regularMaterial, in: .rect(cornerRadius: 9))
          .overlay(RoundedRectangle(cornerRadius: 9).strokeBorder(.primary.opacity(0.12)))
          .shadow(color: .black.opacity(0.12), radius: 3, y: 1)
          // The pill reaches over the row above; a right-click on it must open this row's menu, not nothing or that row's.
          .overlay { menuArea }
          .onHover { isReplyHovered = $0 }
          .opacity(showsActions ? 1 : 0)
          .allowsHitTesting(showsActions)
          .padding(.trailing, horizontalInset)
          .offset(y: -(replyActionHeight + 6) / 2)
        }
      }
      .onChange(of: showsActions) { _, visible in
        // Read history only on entry. Keep targets stable while hovering,
        // keyboard-focused, or choosing from the picker.
        if visible {
          quickReactions = ReactionEmojiHistory().quickReactions
        }
      }
      .onChange(of: row.actions.canReact) { _, canReact in
        if !canReact {
          showsReactionPicker = false
        }
      }
      // Track the complete row, including its action overlay. The toolbar
      // must not change the hover region when it becomes interactive.
      .onContinuousHover { phase in
        let hovering = switch phase {
        case .active: true
        case .ended: false
        }
        if isHovered != hovering {
          isHovered = hovering
        }
      }
      .task(id: (isHovered || isReplyHovered) && !transcriptIsScrolling) {
        hoverRested = false
        guard isHovered || isReplyHovered, !transcriptIsScrolling else { return }
        try? await Task.sleep(for: hoverDelay)
        if !Task.isCancelled {
          hoverRested = true
        }
      }
      .alert(failure?.failure.title ?? "", item: $failure) { _ in
        Button("OK", role: .cancel) {}
      } message: { failure in
        Text(failure.message)
      }
      .alert("Sent to yourself", isPresented: Binding(get: { sentToSelf != nil }, set: {
        if !$0 {
          sentToSelf = nil
        }
      }), presenting: sentToSelf) { saved in
        Button("Open") { openSavedMessage(saved) }
        Button("OK", role: .cancel) {}
      }
      // Web's words (`Message.delete`, `Message.deleteConfirm`), kept although since 19a a deleted message leaves
      // the transcript on web as here; only a deleted Thread parent still reads "This message was deleted".
      .alert("Delete", isPresented: $confirmsDeletion) {
        Button("Cancel", role: .cancel) {}
        Button("Delete", role: .destructive) { deleteMessage() }
      } message: {
        Text("Delete this message? Others will see that it was deleted.")
      }
      // AppKit answers a right-click on selectable text with its own editing menu, so the row opens its menu itself.
      .overlay { menuArea }
      .accessibilityElement(children: .contain)
      .accessibilityActions {
        ForEach(row.actions.menuSections(hasSelection: false, isPinned: isPinned).joined().filter { !menuBusy.contains($0) }, id: \.self) { action in
          Button(action.title, role: action == .delete ? .destructive : nil) { performMenuAction(action) }
        }
      }
      // Sender-group separation is outside the consistently padded hover row.
      .padding(.top, isContinuation ? 0 : 8)
    }

    @ViewBuilder
    private func bodyPart(_ part: MessageBodyPart) -> some View {
      switch part {
      case let .sokoBotSource(label):
        SokoBotSourceLabelView(label: label)
      case .failedMention:
        failedMentionView
      case let .thought(startedAt, shellWorking):
        CoworkerThoughtView(thought: CoworkerThought(message: message), working: streamThinking || shellWorking,
                            startedAt: startedAt)
      case .deleted:
        Text("This message was deleted")
          .italic()
          .foregroundStyle(.secondary)
      case .quote:
        if let quote = message.quote {
          MessageQuoteView(quote: quote, room: room, channels: channels, jump: quoteJump(for: quote))
            .id(quote.messageId + quote.snippet)
        }
      case .editComposer:
        if let editing {
          MessageEditComposer(editing: editing).id(message.id)
        } else {
          markdownBody
        }
      case let .projectSelection(reply):
        ProjectSelectionChip(projectId: reply.projectId, mark: reply.mark)
      case .markdown:
        markdownBody
      }
    }

    private var markdownBody: some View {
      MessageMarkdownView(source: message.content, room: room, channels: channels, preparedDocument: preparedDocument)
    }

    private func actionControls(compact: Bool) -> some View {
      HStack(spacing: 2) {
        if let sokoBotChain = row.sokoBotChain {
          SokoBotChainBadge(chain: sokoBotChain)
            .padding(.horizontal, 4)
        }
        // Web puts a turn's thumbs after the hop badge and ahead of the reactions (row 38b).
        if let sokoBotFeedback {
          sokoBotFeedbackButton(sokoBotFeedback, useful: true)
          sokoBotFeedbackButton(sokoBotFeedback, useful: false)
        }
        if row.actions.canReact {
          ForEach(Array(quickReactions.enumerated()), id: \.element.id) { index, emoji in
            quickReactionButton(emoji, position: index)
          }
          messageAction("React", symbol: "face.smiling", focus: .react, compact: compact) { showsReactionPicker = true }
        }
        if row.actions.canReply {
          messageAction("Reply", symbol: "text.bubble", focus: .reply, compact: compact) { _ = perform?(.reply) }
        }
        if row.actions.canQuote {
          messageAction("Quote", symbol: "quote.opening", focus: .quote, compact: compact) { _ = perform?(.quote) }
        }
        let actions = row.actions
        if actions.canEdit || actions.canDelete || actions.canPin || actions.canCopyLink || actions.canSendToSelf {
          moreActions
        }
      }
      .fixedSize()
    }

    private var moreActions: some View {
      Menu {
        if row.actions.canPin {
          pinButton
        }
        if row.actions.canCopyLink {
          copyLinkButton
        }
        if row.actions.canSendToSelf {
          sendToSelfButton
        }

        if row.actions.canEdit {
          Button("Edit message", systemImage: "pencil") { _ = perform?(.edit) }
        }
        if row.actions.canEdit, row.actions.canDelete {
          Divider()
        }
        if row.actions.canDelete {
          Button("Delete message", systemImage: "trash", role: .destructive) { confirmsDeletion = true }
        }
      } label: {
        Image(systemName: "ellipsis")
          .font(.callout)
          .frame(width: actionIconSize, height: actionIconSize)
      }
      .menuStyle(.button)
      .buttonStyle(.plain)
      .menuIndicator(.hidden)
      .frame(width: replyActionHeight, height: replyActionHeight)
      .foregroundStyle(hoveredAction == .more ? .primary : .secondary)
      .background(hoveredAction == .more ? Color.primary.opacity(0.1) : .clear, in: .rect(cornerRadius: 5))
      .contentShape(.rect)
      .onHover { hoveredAction = $0 ? .more : nil }
      .focused($focusedAction, equals: .more)
      .disabled(isDeleting)
      .help(isDeleting ? "Deleting message…" : "More message actions")
      .accessibilityLabel("More message actions")
    }

    private func quickReactionButton(_ emoji: ReactionEmoji, position: Int) -> some View {
      let focus = MessageAction.quickReaction(position)
      let reacted = message.reactions.contains { $0.emoji == emoji.emoji && $0.reactedByCurrentUser }
      return Button { toggleReaction(emoji.emoji) } label: {
        Text(emoji.emoji)
          .font(.title3)
          .scaleEffect(!reduceMotion && hoveredAction == focus ? 1.15 : 1)
          .animation(reduceMotion ? nil : .easeOut(duration: 0.1), value: hoveredAction == focus)
          .frame(width: replyActionHeight, height: replyActionHeight)
          .background(reacted ? Color.accentColor.opacity(0.18) : .clear, in: .rect(cornerRadius: 5))
          .background(hoveredAction == focus ? Color.primary.opacity(0.1) : .clear, in: .rect(cornerRadius: 5))
          .contentShape(.rect)
      }
      .buttonStyle(.plain)
      .onHover { hoveredAction = $0 ? focus : nil }
      .focused($focusedAction, equals: focus)
      .help(":\(emoji.name):")
      .accessibilityLabel("Toggle \(emoji.emoji) reaction")
      .accessibilityValue(reacted ? "You reacted" : "You have not reacted")
      .accessibilityAddTraits(reacted ? .isSelected : [])
    }

    private func messageAction(_ title: String, symbol: String, focus: MessageAction, compact: Bool, action: @escaping () -> Void) -> some View {
      Button(action: action) {
        MessageActionLabel(title: title, symbol: symbol, hovered: hoveredAction == focus, compact: compact,
                           iconSize: actionIconSize, height: replyActionHeight)
      }
      .buttonStyle(.plain)
      .onHover { hoveredAction = $0 ? focus : nil }
      .focused($focusedAction, equals: focus)
      .help(title == "Reply" ? "Reply in thread" : title)
      .accessibilityLabel(title)
    }

    /// Web `SokoBotFeedbackButtons`: an icon-only control; the chosen one fills, and both lock at half strength
    /// while the rating is sent and once it stuck.
    private func sokoBotFeedbackButton(_ feedback: SokoBotFeedback, useful: Bool) -> some View {
      let focus = MessageAction.feedback(useful: useful)
      let chosen = feedback.isChosen(useful: useful)
      let symbol = (useful ? "hand.thumbsup" : "hand.thumbsdown") + (chosen ? ".fill" : "")
      return Button { rateSokoBotTurn(useful: useful) } label: {
        MessageActionLabel(title: SokoBotFeedback.title(useful: useful), symbol: symbol,
                           hovered: hoveredAction == focus && !feedback.isLocked, compact: true,
                           iconSize: actionIconSize, height: replyActionHeight)
      }
      .buttonStyle(.plain)
      .disabled(feedback.isLocked || perform == nil)
      // The label's resolved foreground does not dim with `.disabled`.
      .opacity(feedback.isLocked ? 0.5 : 1)
      .onHover { hoveredAction = $0 ? focus : nil }
      .focused($focusedAction, equals: focus)
      .help(feedback.help(useful: useful))
      .accessibilityLabel(SokoBotFeedback.title(useful: useful))
      .accessibilityAddTraits(chosen ? .isSelected : [])
    }

    /// Web drops a rejected rating without a word: the thumbs simply unlock.
    private func rateSokoBotTurn(useful: Bool) {
      guard perform != nil, sokoBotFeedback?.isLocked == false else { return }
      Task { @MainActor in try? await run(.rate(useful: useful)) }
    }

    private var pendingSince: Date? {
      outbound?.status == .pending ? outbound?.createdAt : nil
    }

    private var copyLinkButton: some View {
      Button("Copy link", systemImage: "link", action: copyMessageLink)
    }

    private func copyMessageLink() {
      guard let url = ChatLink.href(roomId: message.roomId, messageId: message.id, webBaseURL: CoreSettings.webBaseURL) else {
        return
      }
      PlatformPasteboard.copy(url.absoluteString)
    }

    private var sendToSelfButton: some View {
      Button("Send to yourself", systemImage: "paperplane", action: sendToSelf)
        .disabled(isSendingToSelf)
    }

    private func sendToSelf() {
      guard let onSendToSelf, !isSendingToSelf else { return }
      isSendingToSelf = true
      Task { @MainActor in
        defer { isSendingToSelf = false }
        do {
          sentToSelf = try await onSendToSelf()
        } catch {
          fail(.sendToSelf, error)
        }
      }
    }

    private func openSavedMessage(_ saved: Components.Schemas.ChatRoomMessage) {
      if let url = ChatLink.href(roomId: saved.roomId, messageId: saved.id, webBaseURL: CoreSettings.webBaseURL) {
        openURL(url)
      }
    }

    /// A quote sent to yourself from another room follows its Message link; same-room quotes scroll.
    private func quoteJump(for quote: Components.Schemas.ChatRoomMessageQuote) -> ((String) -> Void)? {
      guard let url = quoteSourceURL(quote, inRoom: message.roomId, webBaseURL: CoreSettings.webBaseURL) else {
        return perform.map { perform in { _ = perform(.jumpToQuote($0)) } }
      }
      return { _ in openURL(url) }
    }

    private var pinButton: some View {
      Button(isPinned ? "Unpin message" : "Pin message", systemImage: isPinned ? "pin.slash" : "pin", action: togglePin)
        .disabled(isUpdatingPin)
    }

    private func togglePin() {
      Task { @MainActor in
        do {
          try await run(.togglePin)
        } catch {
          fail(.pin, error)
        }
      }
    }

    private var menuArea: some View {
      MessageContextMenuArea(actions: row.actions, isPinned: isPinned, sokoBotFeedback: sokoBotFeedback, busy: menuBusy,
                             perform: performMenuAction)
        .accessibilityHidden(true)
    }

    private var menuBusy: Set<MessageMenuAction> {
      MessageRowActivity(isDeleting: isDeleting, isSendingToSelf: isSendingToSelf, isUpdatingPin: isUpdatingPin,
                         feedbackLocked: sokoBotFeedback?.isLocked == true).busy
    }

    private func performMenuAction(_ action: MessageMenuAction) {
      switch action {
      case .copySelection: break // The menu item sends `copy:` to the text view itself.
      case .useful, .notUseful: rateSokoBotTurn(useful: action == .useful)
      case .addReaction: showsReactionPicker = true
      case .edit: _ = perform?(.edit)
      case .quote: _ = perform?(.quote)
      case .reply: _ = perform?(.reply)
      case .pin, .unpin: togglePin()
      case .copyLink: copyMessageLink()
      case .sendToSelf: sendToSelf()
      case .delete: confirmsDeletion = true
      }
    }

    private var avatarView: some View {
      ParticipantAvatar(
        imageURL: messageSenderImage(message.sender),
        name: messageSenderName(message.sender),
        size: Self.avatarDiameter
      )
    }
  }

  #if DEBUG
    private func previewMessage(
      id: String,
      content: String,
      name: String,
      minutesAfterNoon: Int,
      edited: Bool = false
    ) -> Components.Schemas.ChatRoomMessage {
      // Base is 2026-09-08T12:00:00Z, so the name matches the clock.
      let createdAt = Date(timeIntervalSince1970: 1_788_868_800 + Double(minutesAfterNoon * 60))
      return .init(
        id: id,
        roomId: "room_1",
        parentMessageId: nil,
        content: content,
        createdAt: createdAt,
        deletedAt: nil,
        editedAt: edited ? createdAt : nil,
        sender: .case1(.init(
          _type: .user,
          user: .init(id: "user_2", name: name, email: "ada@example.com", presence: .offline)
        )),
        mentions: [],
        reactions: [],
        threadReplyCount: 0,
        threadLastReplyAt: nil,
        metadata: nil,
        quote: nil,
        membership: nil,
        unfurls: nil
      )
    }

    #Preview("Message rows") {
      let context = TranscriptContext(room: nil, viewerId: "", allowsPins: false, allowsThreads: true)
      let first = previewMessage(id: "m1", content: "Morning all — the tracer renders web-style rows now.", name: "Ada", minutesAfterNoon: 0)
      let second = previewMessage(id: "m2", content: "Same burst, so no second header.", name: "Ada", minutesAfterNoon: 1)
      let edited = previewMessage(id: "m3", content: "Edited after the fact.", name: "Ada", minutesAfterNoon: 30, edited: true)
      VStack(alignment: .leading, spacing: 0) {
        DaySeparatorRow(label: "Today")
        MessageRowView(message: first, row: MessageRow(first, in: context, previous: nil, isNewest: false),
                       outbound: nil)
        MessageRowView(message: second, row: MessageRow(second, in: context, previous: first, isNewest: false),
                       outbound: nil)
        MessageRowView(message: edited, row: MessageRow(edited, in: context, previous: second, isNewest: true),
                       outbound: nil)
        RoomStatusRow(text: Text(verbatim: "Bob joined"))
        RoomStatusRow(text: groupNameChangeText(.named(actor: "Ada", name: "Launch crew")))
      }
      .padding()
    }
  #endif

#endif

import CoreAPI
import SokosumiAuth
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

  struct MessageRowView: View {
    /// Avatar edge: web uses 32px, but that reads oversized next to the
    /// native sidebar (28pt "me" avatar), so the transcript matches in-app.
    static let avatarDiameter: CGFloat = 28

    var channels: [ComposerChannel] = []
    var room: Components.Schemas.ChatRoom?
    var preparedDocument: MessageMarkdown?
    let message: Components.Schemas.ChatRoomMessage
    let isContinuation: Bool
    let outbound: OutboundShell?
    var sentAt: Date?
    let onRetry: (() -> Void)?
    let onRemove: (() -> Void)?
    /// Mentioner-only retry of a failed coworker mention shell.
    var onRetryMention: (() async throws -> Void)?
    var onReply: (() -> Void)?
    var onQuote: (() -> Void)?
    var onEdit: (() -> Void)?
    /// The mark a jump left on this row, while it lasts (row 25b1).
    var jumpMark: JumpMark?
    var isPinned = false
    var isUpdatingPin = false
    var onTogglePin: (() async throws -> Void)?
    var onDelete: (() async throws -> Void)?
    var onRemoveUnfurl: ((String) async throws -> Void)?
    /// Returns whether the requests this tap started left the viewer's reaction on the message.
    var onToggleReaction: ((String) async throws -> Bool)?
    var editing: MessageEditing?
    var onQuoteJump: ((String) -> Void)?
    /// Send to yourself. Absent inside the Self Direct and for rows that are not durable.
    var onSendToSelf: (() async throws -> Components.Schemas.ChatRoomMessage)?
    /// The Soko Bot turn's useful / not useful thumbs, on a row that carries them (row 38b).
    var sokoBotFeedback: SokoBotFeedback?
    var onSokoBotFeedback: ((Bool) async throws -> Void)?
    var horizontalInset: CGFloat = 0
    var streamThinking = false
    /// The room transcript's newest message, whose body ends in a run of files (row 31b3, web
    /// `newestEndsInAttachment`). Known before the read state, so the corner the faces need is there from the
    /// first layout and nothing moves when they arrive.
    var newestEndsInAttachment = false
    /// Who has read this far: set on the room transcript's newest message only (row 31b1).
    var seenBy: SeenBy?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.openURL) private var openURL
    @Environment(\.timeFormat) private var timeFormat
    @State private var quickReactions = ReactionEmojiHistory.defaultQuickReactions
    @State private var showsReactionPicker = false
    @State private var confirmsDeletion = false
    @State private var isDeleting = false
    @State private var isRetryingMention = false
    @State private var isSendingToSelf = false
    @State private var sentToSelf: Components.Schemas.ChatRoomMessage?
    @State private var failure: Failure?
    @State private var isHovered = false
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

    /// One OK-dismiss alert for pin, reaction, delete, mention retry, and send-to-self failures.
    private struct Failure {
      let title: String
      let message: String
    }

    private var showsActions: Bool {
      isHovered || isReplyHovered || focusedAction != nil || showsReactionPicker
    }

    /// Persisted mention shell (thinking or failed); nil for ordinary rows.
    private var mentionShell: MentionThoughtShell? {
      MentionThoughtShell(message: message)
    }

    /// Web `isDurableRoomMessage`: no link while the shell is still thinking.
    private var canCopyMessageLink: Bool {
      message.deletedAt == nil
        && !isOutboundLocalMessage(message)
        && !message.id.hasPrefix("stream:")
        && mentionShell?.isThinking != true
    }

    /// Hop badge on a message one assistant wrote to another; web shows it in the hover pill.
    private var sokoBotChain: SokoBotChainMetadata? {
      SokoBotChainMetadata(message: message)
    }

    private var showsActionChrome: Bool {
      message.deletedAt == nil
        && mentionShell?.isThinking != true
        && (onReply != nil || onQuote != nil || onEdit != nil || onDelete != nil
          || onTogglePin != nil || onToggleReaction != nil || canCopyMessageLink || onSendToSelf != nil || sokoBotChain != nil
          || sokoBotFeedback != nil)
    }

    private var isEditingThisRow: Bool {
      editing?.source?.id == message.id
    }

    private var showsReactions: Bool {
      message.deletedAt == nil && outbound == nil && !message.reactions.isEmpty
    }

    /// Link previews and the Soko Bot footer follow a settled body only.
    private var showsBodyExtras: Bool {
      outbound == nil && mentionShell == nil
    }

    private var unfurls: [Components.Schemas.ChatRoomMessageUnfurl] {
      showsBodyExtras ? message.unfurls ?? [] : []
    }

    /// Web renders the Soko Bot footer only once the turn's answer is in the row, and only with approvals or Tasks.
    private var sokoBotFooter: SokoBotTurnMetadata? {
      guard showsBodyExtras, let turn = SokoBotTurnMetadata(message: message), turn.hasFooter else { return nil }
      return turn
    }

    private var threadReplyBar: ThreadReplyBar? {
      onReply == nil ? nil : ThreadReplyBar(message: message)
    }

    /// Web `keepsSeenByCornerClear` (row 31b3): the newest message's body ends in attachments and nothing is drawn
    /// after it — no reactions, Thread bar, link preview, Soko Bot footer or failed send, and it is not being
    /// edited. The faces then sit under the attachment instead of beside it, so the column never narrows for them.
    private var keepsSeenByCornerClear: Bool {
      newestEndsInAttachment && message.deletedAt == nil && mentionShell == nil && !isEditingThisRow && !showsReactions
        && threadReplyBar == nil && unfurls.isEmpty && sokoBotFooter == nil && outbound?.status != .failed
    }

    private var reactionAction: ((String) -> Void)? {
      guard onToggleReaction != nil else { return nil }
      return { emoji in toggleReaction(emoji) }
    }

    private func toggleReaction(_ emoji: String) {
      guard let onToggleReaction else { return }
      Task { @MainActor in
        do {
          // Match web: adding teaches quick reactions; removing does not. Taps
          // absorbed by a running request answer false, so on/off/on counts once.
          if try await onToggleReaction(emoji) {
            ReactionEmojiHistory().record(emoji)
          }
        } catch {
          failure = Failure(title: "Couldn’t update reaction", message: friendlyMessage(for: error))
        }
      }
    }

    private func deleteMessage() {
      guard !isDeleting, let onDelete else { return }
      isDeleting = true
      Task { @MainActor in
        defer { isDeleting = false }
        do { try await onDelete() } catch {
          failure = Failure(title: "Couldn’t delete message", message: friendlyMessage(for: error))
        }
      }
    }

    /// Retry state lives on the row: optimistic thinking unmounts the failed
    /// shell, and a child alert would die with it.
    private func retryMention() {
      guard !isRetryingMention, let onRetryMention else { return }
      isRetryingMention = true
      Task { @MainActor in
        defer { isRetryingMention = false }
        do { try await onRetryMention() } catch {
          failure = Failure(title: "Couldn’t retry the mention", message: friendlyMessage(for: error))
        }
      }
    }

    private var mentionRetryHandler: (() -> Void)? {
      guard onRetryMention != nil else { return nil }
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
        // Header-to-body rhythm mirrors web: space-y-1.5 (6pt) under the
        // header, and gap-x-2.5 (10pt) between name and time.
        VStack(alignment: .leading, spacing: 6) {
          if isContinuation, isPinned, message.deletedAt == nil {
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
              if message.editedAt != nil, message.deletedAt == nil {
                Text("Edited").help(message.editedAt.map { timeFormat.edited($0) } ?? "")
                  .font(.caption)
                  .foregroundStyle(.secondary)
              }
              if isPinned, message.deletedAt == nil {
                pinnedLabel
              }
            }
          }
          let mentionShell = mentionShell
          // Web draws it at the top of a settled body, above the Thought and the text; not while the row is edited (row 38c).
          if let sourceLabel = SokoBotSourceLabel(message: message), editing?.source?.id != message.id {
            SokoBotSourceLabelView(label: sourceLabel)
          }
          if case .failed? = mentionShell {
            failedMentionView
          } else if hasThoughtView(message) {
            // A persisted mention shell keeps the live Thought header until Core
            // fills the answer; its clock starts at `thought_timing_ms.start`.
            CoworkerThoughtView(thought: CoworkerThought(message: message),
                                working: streamThinking || mentionShell != nil,
                                startedAt: mentionShell?.startedAt ?? message.createdAt)
          }
          if message.deletedAt != nil {
            Text("This message was deleted")
              .italic()
              .foregroundStyle(.secondary)
          } else {
            if let quote = message.quote {
              MessageQuoteView(quote: quote, room: room, channels: channels, jump: quoteJump(for: quote))
                .id(quote.messageId + quote.snippet)
            }
            if let editing, isEditingThisRow {
              MessageEditComposer(editing: editing).id(message.id)
            } else if mentionShell == nil, message.quote == nil || !message.content.isEmpty {
              // Mention shells render their own state; Send to yourself posts only a quote, so there is no body to render.
              MessageMarkdownView(source: message.content, room: room, channels: channels, preparedDocument: preparedDocument)
            }
            ForEach(unfurls, id: \.url) { preview in
              MessageUnfurlView(preview: preview, remove: onRemoveUnfurl.map { action in { try await action(preview.url) } })
                .id(preview.url + (preview.imageUrl ?? ""))
            }
            if let sokoBotFooter {
              SokoBotMessageFooterView(turn: sokoBotFooter)
            }
            if isContinuation, message.editedAt != nil {
              Text("Edited").help(message.editedAt.map { timeFormat.edited($0) } ?? "").font(.caption).foregroundStyle(.secondary)
            }
          }
          if showsReactions {
            MessageReactionsView(reactions: message.reactions, toggle: reactionAction)
          }
          if let onReply, let bar = threadReplyBar {
            ThreadReplyBarButton(bar: bar, open: onReply)
              .padding(.top, 4)
          }
          if let outbound, outbound.status == .failed {
            if let error = outbound.errorMessage, !error.isEmpty {
              Text(error)
                .font(.caption)
                .foregroundStyle(.secondary)
            }
            HStack(spacing: 12) {
              if let onRetry {
                Button("Retry", action: onRetry)
              }
              if let onRemove {
                Button("Remove", role: .destructive, action: onRemove)
              }
            }
            .buttonStyle(.borderless)
            .font(.caption)
          }
        }
        // The faces sit in the corner, out of the text flow; the column gives up their width so no line runs under
        // them. A newest body ending in attachments keeps their height under it instead, from the first layout, with
        // the 4 pt they keep from the row's edge between them and the attachment.
        .padding(.trailing, keepsSeenByCornerClear ? 0 : seenBy.map { SeenByFaces.width(for: $0) + 8 } ?? 0)
        .padding(.bottom, keepsSeenByCornerClear ? SeenByFaces.faceDiameter + 4 : 0)
        .frame(maxWidth: .infinity, alignment: .leading)
      }
      .padding(.vertical, 4)
      .padding(.horizontal, horizontalInset)
      .contentShape(.rect)
      .background {
        if let jumpMark {
          JumpMarkBackground(mark: jumpMark)
        } else if isHovered || isReplyHovered, showsActionChrome {
          Color.primary.opacity(0.04)
        }
      }
      // Web's `absolute end-2 bottom-1`: the action pill's trailing edge, at the bottom of the row.
      .overlay(alignment: .bottomTrailing) {
        if let seenBy {
          SeenByButton(seenBy: seenBy)
            .padding(.trailing, horizontalInset)
            .padding(.bottom, 4)
        }
      }
      .overlay(alignment: .topTrailing) {
        if showsActionChrome {
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
      .onChange(of: onToggleReaction != nil) { _, canReact in
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
      .alert(failure?.title ?? "", item: $failure) { _ in
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
        ForEach(menuAvailability.sections(hasSelection: false).joined().filter { !menuBusy.contains($0) }, id: \.self) { action in
          Button(action.title, role: action == .delete ? .destructive : nil) { performMenuAction(action) }
        }
      }
      // Sender-group separation is outside the consistently padded hover row.
      .padding(.top, isContinuation ? 0 : 8)
    }

    private func actionControls(compact: Bool) -> some View {
      HStack(spacing: 2) {
        if let sokoBotChain {
          SokoBotChainBadge(chain: sokoBotChain)
            .padding(.horizontal, 4)
        }
        // Web puts a turn's thumbs after the hop badge and ahead of the reactions (row 38b).
        if let sokoBotFeedback {
          sokoBotFeedbackButton(sokoBotFeedback, useful: true)
          sokoBotFeedbackButton(sokoBotFeedback, useful: false)
        }
        if onToggleReaction != nil {
          ForEach(Array(quickReactions.enumerated()), id: \.element.id) { index, emoji in
            quickReactionButton(emoji, position: index)
          }
          messageAction("React", symbol: "face.smiling", focus: .react, compact: compact) { showsReactionPicker = true }
        }
        if let onReply {
          messageAction("Reply", symbol: "text.bubble", focus: .reply, compact: compact, action: onReply)
        }
        if let onQuote {
          messageAction("Quote", symbol: "quote.opening", focus: .quote, compact: compact, action: onQuote)
        }
        if onEdit != nil || onDelete != nil || onTogglePin != nil || canCopyMessageLink || onSendToSelf != nil {
          moreActions
        }
      }
      .fixedSize()
    }

    private var moreActions: some View {
      Menu {
        if onTogglePin != nil {
          pinButton
        }
        if canCopyMessageLink {
          copyLinkButton
        }
        if onSendToSelf != nil {
          sendToSelfButton
        }

        if let onEdit {
          Button("Edit message", systemImage: "pencil", action: onEdit)
        }
        if onEdit != nil, onDelete != nil {
          Divider()
        }
        if onDelete != nil {
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
    /// (web's `disabled:opacity-50`) while the rating is sent and once it stuck.
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
      .disabled(feedback.isLocked || onSokoBotFeedback == nil)
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
      guard let onSokoBotFeedback, sokoBotFeedback?.isLocked == false else { return }
      Task { @MainActor in try? await onSokoBotFeedback(useful) }
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
          failure = Failure(title: "Couldn’t send to yourself", message: friendlyMessage(for: error))
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
        return onQuoteJump
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
          try await onTogglePin?()
        } catch {
          failure = Failure(title: "Couldn’t update pin", message: friendlyMessage(for: error))
        }
      }
    }

    private var menuArea: some View {
      MessageContextMenuArea(availability: menuAvailability, busy: menuBusy, perform: performMenuAction)
        .accessibilityHidden(true)
    }

    /// What the right-click menu and the accessibility actions offer.
    var menuAvailability: MessageMenuAvailability {
      let live = message.deletedAt == nil
      return MessageMenuAvailability(
        sokoBotFeedback: sokoBotFeedback,
        canReact: onToggleReaction != nil && live,
        canEdit: onEdit != nil,
        canQuote: onQuote != nil,
        canReply: onReply != nil && live,
        pinned: onTogglePin == nil ? nil : isPinned,
        canCopyLink: canCopyMessageLink,
        canSendToSelf: onSendToSelf != nil,
        canDelete: onDelete != nil && live
      )
    }

    private var menuBusy: Set<MessageMenuAction> {
      var busy: Set<MessageMenuAction> = []
      if isDeleting {
        busy.insert(.delete)
      }
      if isSendingToSelf {
        busy.insert(.sendToSelf)
      }
      if isUpdatingPin {
        busy.formUnion([.pin, .unpin])
      }
      if sokoBotFeedback?.isLocked == true {
        busy.formUnion([.useful, .notUseful])
      }
      return busy
    }

    private func performMenuAction(_ action: MessageMenuAction) {
      switch action {
      case .copySelection: break // The menu item sends `copy:` to the text view itself.
      case .useful, .notUseful: rateSokoBotTurn(useful: action == .useful)
      case .addReaction: showsReactionPicker = true
      case .edit: onEdit?()
      case .quote: onQuote?()
      case .reply: onReply?()
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
      VStack(alignment: .leading, spacing: 0) {
        DaySeparatorRow(label: "Today")
        MessageRowView(
          message: previewMessage(id: "m1", content: "Morning all — the tracer renders web-style rows now.", name: "Ada", minutesAfterNoon: 0),
          isContinuation: false,
          outbound: nil,
          onRetry: nil,
          onRemove: nil
        )
        MessageRowView(
          message: previewMessage(id: "m2", content: "Same burst, so no second header.", name: "Ada", minutesAfterNoon: 1),
          isContinuation: true,
          outbound: nil,
          onRetry: nil,
          onRemove: nil
        )
        MessageRowView(
          message: previewMessage(id: "m3", content: "Edited after the fact.", name: "Ada", minutesAfterNoon: 30, edited: true),
          isContinuation: false,
          outbound: nil,
          onRetry: nil,
          onRemove: nil
        )
        RoomStatusRow(text: Text(verbatim: "Bob joined"))
        RoomStatusRow(text: groupNameChangeText(.named(actor: "Ada", name: "Launch crew")))
      }
      .padding()
    }
  #endif

#endif

import CoreAPI
import SokosumiAuth
import SokosumiChat
import SokosumiWorkspace
import SwiftUI

#if os(macOS)
  /// Transcript pane: avatar rail with Slack-style continuation grouping,
  /// day separator pills, membership status rows, and a native composer.
  struct RoomTimelineView: View {
    @EnvironmentObject private var workspaces: WorkspaceState
    @State private var preparedTranscript: PreparedTranscript?
    let roomId: String

    private var preparationInput: PreparedTranscript.Input {
      let room = workspaces.rooms.first { $0.id == roomId }
      return .init(scope: [workspaces.currentUserId, workspaces.selectionId ?? "", roomId, String(workspaces.timeline.generation)],
                   messages: workspaces.displayedTranscript, mentions: room.map(MessageMentions.init),
                   channels: workspaces.composerChannels, baseURL: CoreSettings.webBaseURL)
    }

    var body: some View {
      let input = preparationInput
      let prepared = preparedTranscript.flatMap { $0.input.scope == input.scope ? $0 : nil }
      // Keep scroll state below this boundary so scrolling does not rebuild the projection.
      RoomTranscriptContent(roomId: roomId, messages: prepared?.overlaying(input.messages) ?? [],
                            hasLiveMessages: !input.messages.isEmpty, preparedTranscript: prepared)
        .modifier(ComposerAttachmentPane(userId: workspaces.currentUserId, organizationId: workspaces.selection?.workspace.organizationId, roomId: roomId))
        .id([workspaces.currentUserId, workspaces.selectionId ?? "", roomId])
        .task(id: input) {
          guard let prepared = try? await PreparedTranscript.prepare(input, reusing: preparedTranscript), !Task.isCancelled else { return }
          preparedTranscript = prepared
        }
    }
  }

  private struct RoomTranscriptContent: View {
    @EnvironmentObject private var workspaces: WorkspaceState
    @EnvironmentObject private var auth: AuthState
    @Environment(\.jumpMarkClock) private var jumpMarkClock
    /// Eager first layout can report near-top before the bottom anchor
    /// lands. Require a trip away from the top before auto-loading.
    @State private var transcriptWasAwayFromTop = false
    @State private var scrollIntent = TimelineScrollIntent()
    @State private var scrollActivity = TranscriptScrollActivity()
    @State private var pendingBottomAlignment = false
    @State private var pendingQuote: Components.Schemas.ChatRoomMessageQuote?
    /// The mark the last jump left on the row it landed on (row 25b1). The open thread keeps its own.
    @State private var jumpMark: JumpMark?
    /// The Thread's parent a reply jump marked while the Thread covered the room (row 25c). The rows behind the
    /// Thread are not laid out, so the room lands on it when the Thread closes (user decision, 2026-10-04).
    @State private var parentBehindThread: String?
    @State private var jumpError: String?
    @State private var jumpCompletion: CheckedContinuation<Bool, Never>?
    @State private var quoteTarget: String?
    @State private var scrollPosition = ScrollPosition(idType: String.self)
    @State private var quoteFocusRequest: String?

    let roomId: String
    let messages: [Components.Schemas.ChatRoomMessage]
    let hasLiveMessages: Bool
    let preparedTranscript: PreparedTranscript?

    private var room: Components.Schemas.ChatRoom? {
      workspaces.rooms.first { $0.id == roomId }
    }

    private var userIsScrolling: Bool {
      scrollActivity.isScrolling
    }

    private func unfurlAction(for message: Components.Schemas.ChatRoomMessage) -> ((String) async throws -> Void)? {
      guard canModifyOwnMessage(message, userId: workspaces.currentUserId) else { return nil }
      return { url in try await workspaces.removeUnfurl(message, url: url, auth: auth) }
    }

    private func reactionAction(for message: Components.Schemas.ChatRoomMessage) -> ((String) async throws -> Bool)? {
      guard canReactToMessage(message), roomTakesNewMessages(room) else { return nil }
      return { emoji in try await workspaces.toggleReaction(message, emoji: emoji, auth: auth) }
    }

    /// The turn's thumbs send through the coordinator, which keeps the rating for the session (row 38b).
    private func sokoBotFeedbackAction(for message: Components.Schemas.ChatRoomMessage) -> ((Bool) async throws -> Void)? {
      guard let turnId = SokoBotFeedback.turnId(for: message) else { return nil }
      return { useful in try await workspaces.sendSokoBotFeedback(turnId: turnId, useful: useful, auth: auth) }
    }

    /// Row 38e1: a settled row with result descriptors reads its cards through the coordinator.
    private func resultPreviewsAction(for message: Components.Schemas.ChatRoomMessage) -> (() async throws -> [Components.Schemas.ChatResultPreview])? {
      guard !MessageResultPreviews.descriptorIds(of: message).isEmpty else { return nil }
      return { try await workspaces.messageResultPreviews(message, auth: auth) }
    }

    /// Row 38h1: picking a project on the row's question card replies to the bot that asked.
    private func selectProjectAction(for message: Components.Schemas.ChatRoomMessage) -> (String, String) async throws -> Void {
      { previewId, projectId in try await workspaces.selectProject(projectId, preview: previewId, question: message, auth: auth) }
    }

    /// Row 38h2: Approve or Reject on a decision card resolves the owner's decision.
    private var resolveDecisionAction: (String, SokoBotDecision.Resolution) async throws -> Void {
      { decisionId, resolution in try await workspaces.resolveSokoBotDecision(decisionId, resolution, auth: auth) }
    }

    private func sendToSelfAction(for message: Components.Schemas.ChatRoomMessage) -> (() async throws -> Components.Schemas.ChatRoomMessage)? {
      guard workspaces.canSendToSelf(message) else { return nil }
      return { try await workspaces.sendMessageToSelf(message, auth: auth) }
    }

    private func deletionAction(for message: Components.Schemas.ChatRoomMessage) -> (() async throws -> Void)? {
      guard canModifyOwnMessage(message, userId: workspaces.currentUserId) else { return nil }
      return { try await workspaces.deleteMessage(message, auth: auth) }
    }

    private func mentionRetryAction(for message: Components.Schemas.ChatRoomMessage) -> (() async throws -> Void)? {
      guard workspaces.canRetryMention(message) else { return nil }
      return { try await workspaces.retryMention(message, auth: auth, now: Date()) }
    }

    var body: some View {
      transcriptBody
        .scrollEdgeEffectStyle(.hard, for: .top)
        .scrollEdgeEffectStyle(.soft, for: .bottom)
        .safeAreaInset(edge: .bottom, spacing: 0) {
          if let notice = ReadOnlyDirectNotice(room: room) {
            ReadOnlyDirectNoticeView(notice: notice, horizontalInset: 20)
          } else {
            ChatComposerView(
              userId: workspaces.currentUserId,
              organizationId: workspaces.selection?.workspace.organizationId,
              roomId: roomId, pendingQuote: $pendingQuote, quoteFocusRequest: quoteFocusRequest
            )
            .id([workspaces.currentUserId, workspaces.selectionId ?? "", roomId])
          }
        }
        .modifier(RoomToolsModifier(roomId: roomId, jump: { try await jumpToMessage($0) }))
        .task(id: workspaces.messageJump) {
          guard let target = workspaces.messageJump, target.roomId == roomId else { return }
          scrollIntent.readOlder()
          if target.isThreadParent {
            // Row 25c: the Thread's parent, marked now on the room's own clock (web's `landOn`), so its hold runs
            // under the Thread; the room lands on it when the Thread closes. It replaces a room jump still landing.
            quoteTarget = nil
            jumpCompletion?.resume(returning: false)
            jumpCompletion = nil
            jumpMark = JumpMark(messageId: target.messageId, landedAt: jumpMarkClock.now)
            parentBehindThread = target.messageId
          } else {
            parentBehindThread = nil
            quoteTarget = target.messageId
          }
          workspaces.consumeMessageJump(target.requestId)
        }
        .onChange(of: workspaces.thread.parent == nil) { _, closed in
          guard closed, let parent = parentBehindThread else { return }
          if workspaces.displayedTranscript.contains(where: { $0.id == parent }) {
            quoteTarget = parent
          } else {
            // Gone from the loaded rows while the Thread was open: nothing to land on, so forget it.
            parentBehindThread = nil
          }
        }
        .task(id: roomId) {
          if room?.kind == .channel {
            try? await workspaces.loadPins(auth: auth)
          }
        }
        .alert("Couldn’t load message", isPresented: Binding(get: { jumpError != nil }, set: {
          if !$0 {
            jumpError = nil
          }
        })) {
          Button("OK", role: .cancel) {}
        } message: { Text(jumpError ?? "") }
        .onChange(of: workspaces.timeline.historicalAnchor) { old, new in
          if old != nil, new == nil {
            scrollIntent.followLatest()
            jumpMark = nil
          }
        }
        .onDisappear { jumpCompletion?.resume(returning: false)
          jumpCompletion = nil
        }
        .onChange(of: roomId) { _, _ in
          jumpMark = nil
          parentBehindThread = nil
          jumpCompletion?.resume(returning: false)
          jumpCompletion = nil
          pendingQuote = nil
          quoteTarget = nil
          scrollPosition = ScrollPosition(idType: String.self)
          transcriptWasAwayFromTop = false
          scrollIntent = TimelineScrollIntent()
          pendingBottomAlignment = false
        }
    }

    @ViewBuilder
    private var transcriptBody: some View {
      if workspaces.transcriptRoomId != roomId || (workspaces.transcriptLoading && !hasLiveMessages) {
        ProgressView("Loading messages…")
          .frame(maxWidth: .infinity, maxHeight: .infinity)
      } else if !hasLiveMessages {
        if let error = workspaces.transcriptError {
          transcriptError(error, retryOlder: false)
        } else if room?.isSelfDirect == true {
          // Web's private-notes empty state (`rooms-client.tsx`:3219-3230).
          ContentUnavailableView(
            "Message yourself",
            systemImage: "bubble.left",
            description: Text("Send yourself notes and to-dos. Only you can see them.")
          )
          .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
          ContentUnavailableView(
            "No messages yet",
            systemImage: "bubble.left",
            description: Text("Start the channel with a message or mention an AI coworker.")
          )
          .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
      } else if messages.isEmpty {
        ProgressView("Loading messages…").frame(maxWidth: .infinity, maxHeight: .infinity)
      } else {
        messageList(messages: messages)
      }
    }

    // swiftlint:disable:next cyclomatic_complexity function_body_length
    private func messageList(messages: [Components.Schemas.ChatRoomMessage]) -> some View {
      // Realize nearby rows only: laying out every rich message makes each
      // scroll event expensive. Keep each message unary and anchored by ID.
      let transcriptRoom = room
      let channels = workspaces.composerChannels
      // Seen by rides the newest row only; asked once per pass.
      let readReceipts = workspaces.roomReadReceipts
      let newestMessageId = messages.last?.id
      return ScrollViewReader { proxy in
        ScrollView {
          LazyVStack(alignment: .leading, spacing: 0) {
            if workspaces.transcriptHasMore {
              PageBoundaryRow(copy: .transcript(isGap: false), status: workspaces.timeline.oldestBoundaryStatus) {
                scrollIntent.readOlder()
                workspaces.loadOlderMessages(auth: auth)
              }
            }
            // An older page's failure is on its row; the banner is for the latest page.
            if let error = workspaces.transcriptError, workspaces.timeline.failedPage != .older {
              inlineError(error)
                .padding(.horizontal, 12)
            }
            if workspaces.directStream.parentMessageId == nil, let error = workspaces.directStream.errorMessage {
              Text(error)
                .foregroundStyle(.secondary)
                .padding(.horizontal, 12)
            }
            let gaps = workspaces.timeline.historyGapMessageIds
            ForEach(Array(messages.enumerated()), id: \.element.id) { index, message in
              let previous = index > 0 ? messages[index - 1] : nil
              let hasGap = gaps.contains(message.id)
              // Unary row: a top-level if (day pill) plus the bubble made the
              // lazy path reserve blank slots. One container per message id.
              VStack(alignment: .leading, spacing: 0) {
                if hasGap {
                  // Web's `useLoadWhenVisible`: the row loads itself once it scrolls into
                  // view; a failure stays on it with Try again, never in the jump alert.
                  PageBoundaryRow(copy: .transcript(isGap: true), status: workspaces.timeline.boundaryLoads.status(of: message.id)) {
                    workspaces.loadHistoryGap(before: message.id, auth: auth)
                  }
                  .onScrollVisibilityChange(threshold: 0.01) { visible in
                    Task { @MainActor in
                      workspaces.setHistoryGapVisible(before: message.id, visible, auth: auth)
                    }
                  }
                }
                if let label = daySeparatorLabel(for: message.createdAt, previous: previous?.createdAt, now: Date()) {
                  DaySeparatorRow(label: label)
                }
                if let status = roomStatusText(message) {
                  RoomStatusRow(text: status)
                    .padding(.horizontal, 12)
                    .jumpSpotlightRow(messageId: message.id)
                } else {
                  let outbound = workspaces.outboundShells.first { $0.id == message.id }
                  MessageRowView(channels: channels, room: transcriptRoom, preparedDocument: preparedTranscript?.document(for: message),
                                 message: message,
                                 isContinuation: isMessageContinuation(previous: hasGap ? nil : previous, current: message),
                                 outbound: outbound,
                                 sentAt: workspaces.outbox.sentAt[message.id],
                                 onRetry: outbound.map { shell in
                                   { workspaces.retryOutbound(clientTurnId: shell.clientTurnId) }
                                 },
                                 onRemove: outbound.map { shell in
                                   { workspaces.removeOutbound(clientTurnId: shell.clientTurnId) }
                                 },
                                 onRetryMention: mentionRetryAction(for: message),
                                 // Web hides the thread button on stream overlays and mention shells (`shouldShowChatRoomThreadButton`),
                                 // and in a Read-only Direct on a message with no replies yet (`canOpenThread`).
                                 onReply: outbound == nil && !message.id.hasPrefix("stream:") && MentionThoughtShell(message: message) == nil
                                   && canOpenThread(message, in: transcriptRoom)
                                   ? { workspaces.openThread(message, auth: auth) } : nil,
                                 // Quoting fills the composer, which a Read-only Direct lacks.
                                 onQuote: canQuoteMessage(message) && roomTakesNewMessages(transcriptRoom) ? { pendingQuote = messageQuote(from: message)
                                   quoteFocusRequest = UUID().uuidString
                                 } : nil,
                                 onEdit: canModifyOwnMessage(message, userId: workspaces.currentUserId) ? { workspaces.startEditing(message) } : nil,
                                 jumpMark: jumpMark?.messageId == message.id ? jumpMark : nil,
                                 isPinned: workspaces.canUsePins && workspaces.isPinned(message),
                                 isUpdatingPin: workspaces.isUpdatingPin(message.id),
                                 onTogglePin: pinAction(for: message),
                                 onDelete: deletionAction(for: message),
                                 onRemoveUnfurl: unfurlAction(for: message),
                                 onToggleReaction: reactionAction(for: message),
                                 editing: workspaces.messageEditing,
                                 onQuoteJump: { id in Task {
                                   do {
                                     // Same-room quote: no Thread parent marked (row 25c).
                                     if try await workspaces.openMessage(id, auth: auth, marksThreadParent: false) == .unavailable {
                                       jumpError = "This message is no longer available."
                                     }
                                   } catch { jumpError = friendlyMessage(for: error) }
                                 } },
                                 onSendToSelf: sendToSelfAction(for: message),
                                 sokoBotFeedback: workspaces.sokoBotFeedback(for: message),
                                 onSokoBotFeedback: sokoBotFeedbackAction(for: message),
                                 loadResultPreviews: resultPreviewsAction(for: message),
                                 selectProject: selectProjectAction(for: message),
                                 resolveDecision: resolveDecisionAction,
                                 horizontalInset: 12,
                                 streamThinking: isCoworkerStreamOverlay(message) && ComposerContent(message.content).text.isEmpty && workspaces.directStream.isBusy,
                                 newestEndsInAttachment: message.id == newestMessageId && MessageMarkdown.endsWithAttachmentRun(message.content),
                                 seenBy: readReceipts.seenBy(messageId: message.id, createdAt: message.createdAt, newestMessageId: newestMessageId))
                    .jumpSpotlightRow(messageId: message.id)
                }
              }
              .background {
                if quoteTarget == message.id {
                  Color.clear.onScrollVisibilityChange(threshold: 0.01) { visible in
                    if visible {
                      completeVisibleJump(message.id)
                    }
                  }
                }
              }
              .id(message.id)
            }
            // Bottom anchor doubles as the trailing breathing room (1pt anchor
            // plus the 8pt the stack used to pad outside). Padding below the
            // anchor would park every scrollTo 8pt short of the true bottom.
            Color.clear.frame(height: 9).id("timeline-bottom")
          }
          .scrollTargetLayout()
          .environment(\.transcriptScrollActivity, scrollActivity)
          .padding(.top, 8)
        }
        // Row 25b2: the other rows step back while the mark holds.
        .jumpSpotlight(for: jumpMark)
        .task {
          // Position after the lazy list mounts. A default initial bottom
          // anchor can leave the viewport unrealized on macOS 27.
          guard workspaces.timeline.historicalAnchor == nil, quoteTarget == nil else { return }
          proxy.scrollTo("timeline-bottom", anchor: .bottom)
        }
        .scrollPosition($scrollPosition)
        .defaultScrollAnchor(scrollIntent.followsLatest ? .bottom : nil, for: .sizeChanges)
        .onChange(of: messages.contains(where: { $0.id == quoteTarget }) ? quoteTarget : nil, initial: true) { _, target in
          guard let target else { return }
          guard workspaces.displayedTranscript.contains(where: { $0.id == target }) else {
            quoteTarget = nil
            if parentBehindThread == target {
              parentBehindThread = nil
            }
            jumpCompletion?.resume(returning: false)
            jumpCompletion = nil
            return
          }
          scrollIntent.readOlder()
          scrollPosition.scrollTo(id: target, anchor: .center)
        }
        .task(id: pendingBottomAlignment && !userIsScrolling && scrollIntent.followsLatest && workspaces.timeline.historicalAnchor == nil) {
          guard pendingBottomAlignment, !userIsScrolling, scrollIntent.followsLatest, workspaces.timeline.historicalAnchor == nil else { return }
          pendingBottomAlignment = false
          proxy.scrollTo("timeline-bottom", anchor: .bottom)
        }
        .onScrollPhaseChange { _, phase in
          let scrolling = phase == .interacting || phase == .decelerating || phase == .tracking
          if scrollActivity.isScrolling != scrolling {
            scrollActivity.isScrolling = scrolling
          }
          if phase.endsJumpMark {
            jumpMark = jumpMark?.readerScrolled(at: jumpMarkClock.now)
          }
        }
        .task(id: jumpMark) {
          guard let mark = jumpMark else { return }
          try? await jumpMarkClock.sleep(until: mark.endsAt)
          if !Task.isCancelled, jumpMark == mark {
            jumpMark = nil
          }
        }
        .onChange(of: messages.last?.id) { _, _ in
          if scrollIntent.followsLatest, workspaces.timeline.historicalAnchor == nil {
            proxy.scrollTo("timeline-bottom", anchor: .bottom)
          }
        }
        .overlay(alignment: .bottom) {
          if !scrollIntent.followsLatest || workspaces.timeline.historicalAnchor != nil {
            JumpToLatestButton {
              Task { @MainActor in
                do {
                  if try await workspaces.returnToLatest(auth: auth) {
                    scrollPosition = ScrollPosition(idType: String.self)
                    scrollIntent.followLatest()
                    jumpMark = nil
                    proxy.scrollTo("timeline-bottom", anchor: .bottom)
                  }
                } catch { jumpError = friendlyMessage(for: error) }
              }
            }
          }
        }
        .onScrollGeometryChange(for: CGFloat.self) { $0.containerSize.width } action: { old, new in
          // Closing Pins widens and reflows rich text. Restore the acknowledged
          // target after that layout change while its mark lasts, until the reader starts scrolling.
          if old != new, let marked = jumpMark?.messageId, !userIsScrolling {
            scrollPosition.scrollTo(id: marked, anchor: .center)
            proxy.scrollTo(marked, anchor: .center)
          }
        }
        .onScrollGeometryChange(for: TranscriptScrollEdges.self) { TranscriptScrollEdges($0) } action: { oldEdges, edges in
          if workspaces.timeline.historicalAnchor == nil,
             oldEdges.offsetY != edges.offsetY,
             userIsScrolling || oldEdges.nearBottom != edges.nearBottom {
            if scrollIntent.followsLatest != edges.nearBottom {
              scrollIntent.userScrolled(isNearBottom: edges.nearBottom)
              if !edges.nearBottom {
                pendingBottomAlignment = false
              }
            }
          } else if !oldEdges.hasSameSize(as: edges), scrollIntent.followsLatest, edges.needsBottomAlignment, workspaces.timeline.historicalAnchor == nil {
            if !pendingBottomAlignment {
              pendingBottomAlignment = true
            }
          }
          let isNearTop = edges.nearTop
          if !isNearTop {
            if !transcriptWasAwayFromTop {
              transcriptWasAwayFromTop = true
            }
            return
          }
          var nextIntent = scrollIntent
          guard transcriptWasAwayFromTop, workspaces.transcriptError == nil,
                nextIntent.beginAutomaticOlderPage(
                  userIsScrolling: userIsScrolling,
                  isNearTop: isNearTop,
                  hasMore: workspaces.transcriptHasMore,
                  isLoading: workspaces.transcriptLoading || workspaces.transcriptLoadingOlder
                ) else { return }
          if nextIntent != scrollIntent {
            scrollIntent = nextIntent
          }
          Task { @MainActor in
            workspaces.loadOlderMessages(auth: auth)
          }
        }
      }
    }

    private func pinAction(for message: Components.Schemas.ChatRoomMessage) -> (() async throws -> Void)? {
      guard workspaces.canUsePins, message.parentMessageId == nil, canReactToMessage(message) else { return nil }
      return { try await workspaces.setPinned(!workspaces.isPinned(message), messageId: message.id, auth: auth) }
    }

    private func completeVisibleJump(_ target: String) {
      guard quoteTarget == target else { return }
      // The Thread's parent keeps the mark it got when the jump arrived, or none once that hold has run out.
      if parentBehindThread == target {
        parentBehindThread = nil
      } else {
        jumpMark = JumpMark(messageId: target, landedAt: jumpMarkClock.now)
      }
      quoteTarget = nil
      jumpCompletion?.resume(returning: true)
      jumpCompletion = nil
    }

    private func jumpToMessage(_ id: String) async throws -> MessageNavigationResult {
      let expectedRoom = roomId
      scrollIntent.readOlder()
      let result = try await workspaces.openMessage(id, auth: auth)
      guard result == .opened, workspaces.transcriptRoomId == expectedRoom else {
        return result == .opened ? .superseded : result
      }
      jumpCompletion?.resume(returning: false)
      let landed = await withCheckedContinuation { completion in
        jumpCompletion = completion
        quoteTarget = id
      }
      return landed ? .opened : .superseded
    }

    private func transcriptError(_ error: String, retryOlder: Bool) -> some View {
      errorBanner(error) {
        if retryOlder {
          workspaces.loadOlderMessages(auth: auth)
        } else if let room {
          workspaces.openRoom(room, auth: auth)
        }
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    /// Banner variant for failures above loaded history: no `maxHeight`, which
    /// is illegal inside the scroll view.
    private func inlineError(_ error: String) -> some View {
      errorBanner(error) {
        workspaces.refreshTranscript(auth: auth)
      }
      .frame(maxWidth: .infinity)
    }

    private func errorBanner(_ error: String, retry: @escaping () -> Void) -> some View {
      VStack(spacing: 8) {
        Text(error)
          .foregroundStyle(.secondary)
        Button("Retry", action: retry)
      }
    }
  }

#endif

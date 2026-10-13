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
    /// An older page, prepared and waiting for the list to land it (M6). Rows inserted above the realized ones make the
    /// lazy list measure every realized row again, a dropped frame in mid-flick, so they land once the scroll rests,
    /// and the list puts the rows the reader saw back where they were.
    @State private var waitingTranscript: PreparedTranscript?
    @State private var scrollActivity = TranscriptScrollActivity()
    let roomId: String

    private var preparationInput: PreparedTranscript.Input {
      let room = workspaces.rooms.first { $0.id == roomId }
      return .init(scope: [workspaces.currentUserId, workspaces.selectionId ?? "", roomId, String(workspaces.room.timeline.generation)],
                   messages: workspaces.displayedTranscript, mentions: room.map(MessageMentions.init),
                   channels: workspaces.composerChannels, baseURL: CoreSettings.webBaseURL)
    }

    var body: some View {
      let input = preparationInput
      let prepared = preparedTranscript.flatMap { $0.input.scope == input.scope ? $0 : nil }
      let waiting = waitingTranscript.flatMap { $0.input.scope == input.scope ? $0 : nil }
      let messages = prepared?.overlaying(input.messages) ?? []
      // Projection is a live suffix: a shorter nonempty suffix means its older prefix still waits.
      let olderPageWaits = !messages.isEmpty && messages.count < input.messages.count
      // Keep scroll state below this boundary so scrolling does not rebuild the projection.
      RoomTranscriptContent(roomId: roomId, messages: messages,
                            hasLiveMessages: !input.messages.isEmpty, preparedTranscript: waiting ?? prepared,
                            scrollActivity: scrollActivity, olderPageWaits: olderPageWaits,
                            hasWaitingPage: waiting != nil) {
        if let waiting = waitingTranscript, waiting.input.scope == preparationInput.scope, scrollActivity.isAtRest {
          waitingTranscript = nil
          preparedTranscript = waiting
          return true
        }
        return false
      }
      .modifier(ComposerAttachmentPane(userId: workspaces.currentUserId, organizationId: workspaces.selection?.workspace.organizationId, roomId: roomId))
      .id([workspaces.currentUserId, workspaces.selectionId ?? "", roomId])
      .task(id: input) {
        guard let next = try? await PreparedTranscript.prepare(input, reusing: waitingTranscript ?? preparedTranscript), !Task.isCancelled else { return }
        if next.prependsRows(to: preparedTranscript) {
          waitingTranscript = next
        } else {
          waitingTranscript = nil
          preparedTranscript = next
        }
      }
    }
  }

  private struct RoomTranscriptContent: View {
    @EnvironmentObject private var workspaces: WorkspaceState
    @Environment(\.jumpMarkClock) private var jumpMarkClock
    /// Eager first layout can report near-top before the bottom anchor
    /// lands. Require a trip away from the top before auto-loading.
    @State private var transcriptWasAwayFromTop = false
    @State private var scrollIntent = TimelineScrollIntent()
    @State private var pendingBottomAlignment = false
    @State private var pendingQuote: Components.Schemas.ChatRoomMessageQuote?
    @State private var jumpError: String?
    @State private var scrollPosition = ScrollPosition(idType: String.self)
    @State private var firstRows = FirstRowsPlacement()
    @State private var quoteFocusRequest: String?

    let roomId: String
    let messages: [Components.Schemas.ChatRoomMessage]
    let hasLiveMessages: Bool
    let preparedTranscript: PreparedTranscript?
    /// Whether the reader drives the list; the room view reads it to hold an older page (M6).
    let scrollActivity: TranscriptScrollActivity
    /// An older page is preparing or waits for the scroll to rest: its boundary row stays loading and asks for no
    /// further page.
    let olderPageWaits: Bool
    /// An older page is prepared and waits for the list to land it.
    let hasWaitingPage: Bool
    /// Lands the waiting page's rows unless the reader scrolls; true when it did.
    let landWaitingPage: () -> Bool

    private var room: Components.Schemas.ChatRoom? {
      workspaces.rooms.first { $0.id == roomId }
    }

    private var userIsScrolling: Bool {
      scrollActivity.isScrolling
    }

    /// The mark the last jump left on the row it landed on (row 25b1). The open thread keeps its own.
    private var jumpMark: JumpMark? {
      workspaces.room.jumpTarget?.mark
    }

    /// The row a jump still has to scroll to. The Thread's parent a reply jump marked waits while the Thread covers the
    /// room, because the rows behind it are not laid out (row 25c, user decision 2026-10-04).
    private var scrollTarget: TranscriptSession.JumpTarget? {
      guard let target = workspaces.room.jumpTarget, !target.hasLanded,
            !target.isCovered || workspaces.thread.parent == nil else { return nil }
      return target
    }

    private func unfurlAction(for message: Components.Schemas.ChatRoomMessage) -> ((String) async throws -> Void)? {
      guard canModifyOwnMessage(message, userId: workspaces.currentUserId) else { return nil }
      return { url in try await workspaces.removeUnfurl(message, url: url) }
    }

    private func reactionAction(for message: Components.Schemas.ChatRoomMessage) -> ((String) async throws -> Bool)? {
      guard canReactToMessage(message), roomTakesNewMessages(room) else { return nil }
      return { emoji in try await workspaces.toggleReaction(message, emoji: emoji) }
    }

    /// The turn's thumbs send through the coordinator, which keeps the rating for the session (row 38b).
    private func sokoBotFeedbackAction(for message: Components.Schemas.ChatRoomMessage) -> ((Bool) async throws -> Void)? {
      guard let turnId = SokoBotFeedback.turnId(for: message) else { return nil }
      return { useful in try await workspaces.sendSokoBotFeedback(turnId: turnId, useful: useful) }
    }

    /// Row 38e1: a settled row with result descriptors reads its cards through the coordinator.
    private func resultPreviewsAction(for message: Components.Schemas.ChatRoomMessage) -> (() async throws -> [Components.Schemas.ChatResultPreview])? {
      guard !MessageResultPreviews.descriptorIds(of: message).isEmpty else { return nil }
      return { try await workspaces.messageResultPreviews(message) }
    }

    /// Row 38h1: picking a project on the row's question card replies to the bot that asked.
    private func selectProjectAction(for message: Components.Schemas.ChatRoomMessage) -> (String, String) async throws -> Void {
      { previewId, projectId in try await workspaces.selectProject(projectId, preview: previewId, question: message) }
    }

    /// Row 38h2: Approve or Reject on a decision card resolves the owner's decision.
    private var resolveDecisionAction: (String, SokoBotDecision.Resolution) async throws -> Void {
      { decisionId, resolution in try await workspaces.resolveSokoBotDecision(decisionId, resolution) }
    }

    private func sendToSelfAction(for message: Components.Schemas.ChatRoomMessage) -> (() async throws -> Components.Schemas.ChatRoomMessage)? {
      guard workspaces.canSendToSelf(message) else { return nil }
      return { try await workspaces.sendMessageToSelf(message) }
    }

    private func deletionAction(for message: Components.Schemas.ChatRoomMessage) -> (() async throws -> Void)? {
      guard canModifyOwnMessage(message, userId: workspaces.currentUserId) else { return nil }
      return { try await workspaces.deleteMessage(message) }
    }

    private func mentionRetryAction(for message: Components.Schemas.ChatRoomMessage) -> (() async throws -> Void)? {
      guard workspaces.canRetryMention(message) else { return nil }
      return { try await workspaces.retryMention(message, now: Date()) }
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
            // Row 25c: the Thread's parent, marked now so its hold runs under the Thread; the room lands on it when
            // the Thread closes. It replaces a room jump still landing.
            workspaces.room.markCovered(target.messageId)
          } else {
            workspaces.room.requestJump(to: target.messageId)
          }
          workspaces.consumeMessageJump(target.requestId)
        }
        .onChange(of: workspaces.thread.parent == nil) { _, closed in
          guard closed, let target = workspaces.room.jumpTarget, target.isCovered, !target.hasLanded,
                !workspaces.displayedTranscript.contains(where: { $0.id == target.messageId }) else { return }
          // Gone from the loaded rows while the Thread was open: nothing to land on, so forget it.
          Task { @MainActor in workspaces.room.clearJump() }
        }
        .task(id: roomId) {
          if room?.kind == .channel {
            try? await workspaces.loadPins()
          }
        }
        .alert("Couldn’t load message", isPresented: Binding(get: { jumpError != nil }, set: {
          if !$0 {
            jumpError = nil
          }
        })) {
          Button("OK", role: .cancel) {}
        } message: { Text(jumpError ?? "") }
        .onChange(of: workspaces.room.timeline.historicalAnchor) { old, new in
          if old != nil, new == nil {
            scrollIntent.followLatest()
            Task { @MainActor in workspaces.room.clearJump() }
          }
        }
        .onDisappear {
          // A jump this list never reached ends with it; another room's Transcript has already dropped it.
          let shownRoom = roomId
          Task { @MainActor in
            if workspaces.room.timeline.roomId == shownRoom {
              workspaces.room.clearJump()
            }
          }
          // The room view outlives this list (another workspace or room swaps it): no scroll is left driving it.
          scrollActivity.update(for: .idle)
        }
        .onChange(of: roomId) { _, _ in
          pendingQuote = nil
          scrollPosition = ScrollPosition(idType: String.self)
          transcriptWasAwayFromTop = false
          scrollIntent = TimelineScrollIntent()
          pendingBottomAlignment = false
        }
    }

    @ViewBuilder
    private var transcriptBody: some View {
      if workspaces.room.timeline.roomId != roomId || (workspaces.room.timeline.isLoading && !hasLiveMessages) {
        ProgressView("Loading messages…")
          .frame(maxWidth: .infinity, maxHeight: .infinity)
      } else if !hasLiveMessages {
        if let error = workspaces.room.timeline.errorMessage {
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
            if workspaces.room.timeline.hasMore || olderPageWaits {
              PageBoundaryRow(copy: .transcript(isGap: false), status: olderPageWaits ? .loading : workspaces.room.timeline.oldestBoundaryStatus) {
                scrollIntent.readOlder()
                workspaces.loadOlderMessages()
              }
            }
            // An older page's failure is on its row; the banner is for the latest page.
            if let error = workspaces.room.timeline.errorMessage, workspaces.room.timeline.failedPage != .older {
              inlineError(error)
                .padding(.horizontal, 12)
            }
            if workspaces.directStream.parentMessageId == nil, let error = workspaces.directStream.errorMessage {
              Text(error)
                .foregroundStyle(.secondary)
                .padding(.horizontal, 12)
            }
            let gaps = workspaces.room.timeline.historyGapMessageIds
            let rowContext = TranscriptContext(
              room: transcriptRoom, viewerId: workspaces.currentUserId, allowsPins: workspaces.canUsePins, allowsThreads: true,
              outbound: workspaces.room.outbox.shells, editingMessageId: workspaces.messageEditing.source?.id
            )
            ForEach(Array(messages.enumerated()), id: \.element.id) { index, message in
              let previous = index > 0 ? messages[index - 1] : nil
              let hasGap = gaps.contains(message.id)
              // Unary row: a top-level if (day pill) plus the bubble made the
              // lazy path reserve blank slots. One container per message id.
              VStack(alignment: .leading, spacing: 0) {
                if hasGap {
                  // Web's `useLoadWhenVisible`: the row loads itself once it scrolls into
                  // view; a failure stays on it with Try again, never in the jump alert.
                  PageBoundaryRow(copy: .transcript(isGap: true), status: workspaces.room.timeline.boundaryLoads.status(of: message.id)) {
                    workspaces.loadHistoryGap(before: message.id)
                  }
                  .onScrollVisibilityChange(threshold: 0.01) { visible in
                    Task { @MainActor in
                      workspaces.setHistoryGapVisible(before: message.id, visible)
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
                  let outbound = workspaces.room.outbox.shells.first { $0.id == message.id }
                  MessageRowView(channels: channels, room: transcriptRoom, preparedDocument: preparedTranscript?.document(for: message),
                                 message: message,
                                 row: MessageRow(message, in: rowContext, previous: hasGap ? nil : previous, isNewest: message.id == newestMessageId),
                                 outbound: outbound,
                                 sentAt: workspaces.room.outbox.sentAt[message.id],
                                 onRetry: outbound.map { shell in
                                   { workspaces.retryOutbound(clientTurnId: shell.clientTurnId) }
                                 },
                                 onRemove: outbound.map { shell in
                                   { workspaces.removeOutbound(clientTurnId: shell.clientTurnId) }
                                 },
                                 onRetryMention: mentionRetryAction(for: message),
                                 onReply: { workspaces.openThread(message) },
                                 onQuote: {
                                   pendingQuote = messageQuote(from: message)
                                   quoteFocusRequest = UUID().uuidString
                                 },
                                 onEdit: { workspaces.startEditing(message) },
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
                                     if try await workspaces.openMessage(id, marksThreadParent: false) == .unavailable {
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
                                 seenBy: readReceipts.seenBy(messageId: message.id, createdAt: message.createdAt, newestMessageId: newestMessageId))
                    .jumpSpotlightRow(messageId: message.id)
                }
              }
              .background {
                // Where the first rows sit in the viewport, so an older page landing above them can leave them there.
                if index < 2 || message.id == firstRows.landingAnchor {
                  Color.clear.onGeometryChange(for: CGRect.self) { $0.frame(in: .scrollView) } action: { frame in
                    firstRows.record(index, id: message.id, frame: frame)
                  }
                }
                if scrollTarget?.messageId == message.id {
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
          guard workspaces.room.timeline.historicalAnchor == nil, scrollTarget == nil else { return }
          proxy.scrollTo("timeline-bottom", anchor: .bottom)
        }
        .scrollPosition($scrollPosition)
        .defaultScrollAnchor(scrollIntent.followsLatest ? .bottom : nil, for: .sizeChanges)
        .onChange(of: hasWaitingPage) { _, waits in
          if waits, scrollActivity.isAtRest {
            Task { @MainActor in
              landWaitingPageInPlace()
            }
          }
        }
        .onChange(of: scrollTarget.flatMap { target in messages.contains { $0.id == target.messageId } ? target.messageId : nil }, initial: true) { _, target in
          guard let target else { return }
          guard workspaces.displayedTranscript.contains(where: { $0.id == target }) else {
            Task { @MainActor in workspaces.room.clearJump() }
            return
          }
          scrollIntent.readOlder()
          scrollPosition.scrollTo(id: target, anchor: .center)
        }
        .task(id: pendingBottomAlignment && !userIsScrolling && scrollIntent.followsLatest && workspaces.room.timeline.historicalAnchor == nil) {
          guard pendingBottomAlignment, !userIsScrolling, scrollIntent.followsLatest, workspaces.room.timeline.historicalAnchor == nil else { return }
          pendingBottomAlignment = false
          proxy.scrollTo("timeline-bottom", anchor: .bottom)
        }
        .onScrollPhaseChange { _, phase in
          scrollActivity.update(for: phase)
          // Only a list at rest takes the rows: a jump's scroll animation is motion too.
          if phase == .idle, hasWaitingPage {
            Task { @MainActor in
              landWaitingPageInPlace()
            }
          }
          if phase.endsJumpMark {
            Task { @MainActor in workspaces.room.readerScrolled() }
          }
        }
        .task(id: jumpMark) {
          guard let mark = jumpMark else { return }
          try? await jumpMarkClock.sleep(until: mark.endsAt)
          if !Task.isCancelled, jumpMark == mark {
            workspaces.room.endJumpIfMarkEnded()
          }
        }
        .onChange(of: messages.last?.id) { _, _ in
          if scrollIntent.followsLatest, workspaces.room.timeline.historicalAnchor == nil {
            proxy.scrollTo("timeline-bottom", anchor: .bottom)
          }
        }
        .overlay(alignment: .bottom) {
          if !scrollIntent.followsLatest || workspaces.room.timeline.historicalAnchor != nil {
            JumpToLatestButton {
              Task { @MainActor in
                do {
                  if try await workspaces.returnToLatest() {
                    scrollPosition = ScrollPosition(idType: String.self)
                    scrollIntent.followLatest()
                    workspaces.room.clearJump()
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
          firstRows.viewport = (edges.topInset, edges.viewportHeight)
          firstRows.offset = edges.offsetY
          if workspaces.room.timeline.historicalAnchor == nil,
             oldEdges.offsetY != edges.offsetY,
             userIsScrolling || oldEdges.nearBottom != edges.nearBottom {
            if scrollIntent.followsLatest != edges.nearBottom {
              scrollIntent.userScrolled(isNearBottom: edges.nearBottom)
              if !edges.nearBottom {
                pendingBottomAlignment = false
              }
            }
          } else if !oldEdges.hasSameSize(as: edges), scrollIntent.followsLatest, edges.needsBottomAlignment, workspaces.room.timeline.historicalAnchor == nil {
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
          guard transcriptWasAwayFromTop, workspaces.room.timeline.errorMessage == nil,
                nextIntent.beginAutomaticOlderPage(
                  userIsScrolling: userIsScrolling,
                  isNearTop: isNearTop,
                  hasMore: workspaces.room.timeline.hasMore,
                  isLoading: workspaces.room.timeline.isLoading || workspaces.room.timeline.isLoadingOlder || olderPageWaits
                ) else { return }
          if nextIntent != scrollIntent {
            scrollIntent = nextIntent
          }
          Task { @MainActor in
            workspaces.loadOlderMessages()
          }
        }
      }
    }

    private func pinAction(for message: Components.Schemas.ChatRoomMessage) -> (() async throws -> Void)? {
      guard workspaces.canUsePins, message.parentMessageId == nil, canReactToMessage(message) else { return nil }
      return { try await workspaces.setPinned(!workspaces.isPinned(message), messageId: message.id) }
    }

    /// Lands the waiting older page and puts the rows that were first back where they sat in the viewport (row 04). The
    /// list does not do it by itself: its scroll position names the first row as the page lands, yet the reader ended up
    /// on the page's own first rows (a real trackpad, the paging harness, the CI runner).
    private func landWaitingPageInPlace() {
      let placement = firstRows.placement
      firstRows.landingAnchor = placement?.id
      firstRows.forgetAnchorFrame()
      guard landWaitingPage(), let placement else {
        firstRows.landingAnchor = nil
        return
      }
      scrollPosition.scrollTo(id: placement.id, anchor: placement.anchor)
      // The anchor's fraction is measured against the visible rows; where the list lines it up against more (the CI
      // runner put the row 66 pt low), move it the rest of the way once it has settled.
      Task { @MainActor in
        defer { firstRows.landingAnchor = nil }
        guard await (try? Task.sleep(for: .milliseconds(150))) != nil, scrollActivity.isAtRest,
              let offset = firstRows.settledOffset(for: placement.id, was: placement.minY) else { return }
        scrollPosition.scrollTo(y: offset)
      }
    }

    /// The row came into view: the jump lands. The Thread's parent keeps the mark it got when the jump arrived.
    private func completeVisibleJump(_ target: String) {
      guard let jump = scrollTarget, jump.messageId == target else { return }
      Task { @MainActor in workspaces.room.landJump(jump.requestId) }
    }

    private func jumpToMessage(_ id: String) async throws -> MessageNavigationResult {
      let expectedRoom = roomId
      scrollIntent.readOlder()
      let result = try await workspaces.openMessage(id)
      guard result == .opened, workspaces.room.timeline.roomId == expectedRoom else {
        return result == .opened ? .superseded : result
      }
      return await workspaces.room.jump(to: id) ? .opened : .superseded
    }

    private func transcriptError(_ error: String, retryOlder: Bool) -> some View {
      errorBanner(error) {
        if retryOlder {
          workspaces.loadOlderMessages()
        } else if let room {
          workspaces.openRoom(room)
        }
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    /// Banner variant for failures above loaded history: no `maxHeight`, which
    /// is illegal inside the scroll view.
    private func inlineError(_ error: String) -> some View {
      errorBanner(error) {
        workspaces.refreshTranscript()
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

  /// Where the transcript's first two rows sit in the viewport, and the row an older page's landing keeps in place
  /// (M6, row 04). A plain object: the geometry callbacks write it on every change without updating the view.
  @MainActor private final class FirstRowsPlacement {
    /// The inset above the visible rows and their height.
    var viewport: (topInset: CGFloat, height: CGFloat) = (0, 0)
    /// The list's content offset, as the last geometry change reported it.
    var offset: CGFloat = 0
    /// The row a landing keeps in place, tracked until it has settled.
    var landingAnchor: String?
    private var rows: [Int: (id: String, frame: CGRect)] = [:]
    private var anchorFrame: CGRect?

    struct Placement {
      let id: String
      /// The point of the row lined up with the same point of the viewport.
      let anchor: UnitPoint
      /// Where the row's top sat.
      let minY: CGFloat
    }

    /// A row on screen and where it sat. The second row first: the first row can lose its day pill once rows from the
    /// same day land above it, which moves its text by the pill.
    var placement: Placement? {
      guard viewport.height > 0 else { return nil }
      for index in [1, 0] {
        guard let row = rows[index], row.frame.maxY > viewport.topInset,
              row.frame.minY < viewport.topInset + viewport.height else { continue }
        // `scrollTo(id:anchor:)` lines the row's point at `anchor` up with the viewport's: top + f × (H − h) = top.
        let room = viewport.height - row.frame.height
        let fraction = abs(room) < 1 ? 0 : (row.frame.minY - viewport.topInset) / room
        return Placement(id: row.id, anchor: UnitPoint(x: 0, y: fraction), minY: row.frame.minY)
      }
      return nil
    }

    /// The content offset that puts the landing anchor back at `minY`, when it settled elsewhere.
    func settledOffset(for id: String, was minY: CGFloat) -> CGFloat? {
      guard id == landingAnchor, let frame = anchorFrame, abs(frame.minY - minY) > 1 else { return nil }
      return offset + frame.minY - minY
    }

    func forgetAnchorFrame() {
      anchorFrame = nil
    }

    func record(_ index: Int, id: String, frame: CGRect) {
      if id == landingAnchor {
        anchorFrame = frame
      }
      if index < 2 {
        rows[index] = (id, frame)
      }
    }
  }
#endif

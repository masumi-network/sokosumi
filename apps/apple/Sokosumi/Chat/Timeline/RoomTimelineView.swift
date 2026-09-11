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
    @EnvironmentObject private var auth: AuthState
    /// Eager first layout can report near-top before the bottom anchor
    /// lands. Require a trip away from the top before auto-loading.
    @State private var transcriptWasAwayFromTop = false
    @State private var scrollIntent = TimelineScrollIntent()
    @State private var userIsScrolling = false
    @State private var pendingQuote: Components.Schemas.ChatRoomMessageQuote?
    @State private var quoteTarget: String?

    let roomId: String

    private var room: Components.Schemas.ChatRoom? {
      workspaces.rooms.first { $0.id == roomId }
    }

    var body: some View {
      VStack(spacing: 0) {
        transcriptBody
        ChatComposerView(
          userId: workspaces.currentUserId,
          organizationId: workspaces.selection?.workspace.organizationId,
          roomId: roomId, pendingQuote: $pendingQuote
        )
        .id([workspaces.currentUserId, workspaces.selectionId ?? "", roomId])
      }
      .onChange(of: roomId) { _, _ in
        pendingQuote = nil
        quoteTarget = nil
        transcriptWasAwayFromTop = false
        scrollIntent = TimelineScrollIntent()
      }
    }

    @ViewBuilder
    private var transcriptBody: some View {
      if workspaces.transcriptRoomId != roomId || workspaces.transcriptLoading {
        ProgressView("Loading messages…")
          .frame(maxWidth: .infinity, maxHeight: .infinity)
      } else if workspaces.displayedTranscript.isEmpty {
        if let error = workspaces.transcriptError {
          transcriptError(error, retryOlder: false)
        } else {
          ContentUnavailableView(
            "No messages yet",
            systemImage: "bubble.left",
            description: Text("New messages will appear here.")
          )
          .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
      } else {
        messageList
      }
    }

    private var messageList: some View {
      // Eager stack so the bottom anchor has real last-row geometry on first
      // paint. LazyVStack estimated a tall empty clip; scrolling up realized
      // rows and the blank collapsed. First page is 100 messages.
      ScrollViewReader { proxy in
        ScrollView {
          VStack(alignment: .leading, spacing: 0) {
            if workspaces.transcriptHasMore {
              Button("Load older messages") {
                scrollIntent.readOlder()
                workspaces.loadOlderMessages(auth: auth)
              }
              .disabled(workspaces.transcriptLoadingOlder || workspaces.transcriptRefreshing)
              .buttonStyle(.link)
              .frame(maxWidth: .infinity)
              .padding(.vertical, 8)
            }
            if workspaces.transcriptLoadingOlder {
              ProgressView()
                .frame(maxWidth: .infinity)
                .padding(.vertical, 4)
            }
            if let error = workspaces.transcriptError {
              inlineError(error)
                .padding(.horizontal, 12)
            }
            if workspaces.directStream.parentMessageId == nil, let error = workspaces.directStream.errorMessage {
              Text(error)
                .foregroundStyle(.secondary)
                .padding(.horizontal, 12)
            }
            let messages = workspaces.displayedTranscript
            ForEach(Array(messages.enumerated()), id: \.element.id) { index, message in
              let previous = index > 0 ? messages[index - 1] : nil
              // Unary row: a top-level if (day pill) plus the bubble made the
              // lazy path reserve blank slots. One container per message id.
              VStack(alignment: .leading, spacing: 0) {
                if let label = daySeparatorLabel(for: message.createdAt, previous: previous?.createdAt) {
                  DaySeparatorRow(label: label)
                }
                if let status = membershipStatusText(message) {
                  MembershipStatusRow(text: status)
                    .padding(.horizontal, 12)
                } else {
                  let outbound = workspaces.outboundShells.first { $0.id == message.id }
                  MessageRowView(channels: workspaces.composerChannels, room: workspaces.rooms.first { $0.id == workspaces.transcriptRoomId },
                                 message: message,
                                 isContinuation: isMessageContinuation(previous: previous, current: message),
                                 outbound: outbound,
                                 sentAt: workspaces.outbox.sentAt[message.id],
                                 onRetry: outbound.map { shell in
                                   { workspaces.retryOutbound(clientTurnId: shell.clientTurnId) }
                                 },
                                 onRemove: outbound.map { shell in
                                   { workspaces.removeOutbound(clientTurnId: shell.clientTurnId) }
                                 },
                                 onReply: outbound == nil && !message.id.hasPrefix("stream:") ? { workspaces.openThread(message, auth: auth) } : nil,
                                 onQuote: canQuoteMessage(message) ? { pendingQuote = messageQuote(from: message) } : nil,
                                 onQuoteJump: { id in quoteTarget = id },
                                 horizontalInset: 12,
                                 streamReasoning: streamReasoning(for: message),
                                 streamThinking: isLiveCoworkerOverlay(message) && ComposerContent(message.content).text.isEmpty && workspaces.directStream.isBusy)
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
          .padding(.top, 8)
        }
        .defaultScrollAnchor(.bottom)
        .onChange(of: quoteTarget) { _, target in
          guard let target else { return }
          quoteTarget = nil
          guard workspaces.displayedTranscript.contains(where: { $0.id == target }) else { return }
          scrollIntent.readOlder()
          proxy.scrollTo(target, anchor: .center)
        }
        .onScrollPhaseChange { _, phase in
          userIsScrolling = phase == .interacting || phase == .decelerating
        }
        .onChange(of: workspaces.displayedTranscript.last?.id) { _, _ in
          if scrollIntent.followsLatest {
            proxy.scrollTo("timeline-bottom", anchor: .bottom)
          }
        }
        .overlay(alignment: .bottomTrailing) {
          if !scrollIntent.followsLatest {
            Button("Latest messages", systemImage: "arrow.down") {
              scrollIntent.followLatest()
              proxy.scrollTo("timeline-bottom", anchor: .bottom)
            }
            .buttonStyle(.borderedProminent)
            .padding(12)
          }
        }
        .onScrollGeometryChange(for: [Double].self) { geometry in
          [geometry.visibleRect.minY, geometry.contentSize.height - geometry.visibleRect.maxY]
        } action: { _, geometry in
          if userIsScrolling {
            scrollIntent.userScrolled(distanceFromBottom: geometry[1])
          } else if scrollIntent.followsLatest {
            proxy.scrollTo("timeline-bottom", anchor: .bottom)
          }
          let isNearTop = geometry[0] < 40
          if !isNearTop {
            transcriptWasAwayFromTop = true
            return
          }
          guard transcriptWasAwayFromTop, workspaces.transcriptError == nil,
                scrollIntent.beginAutomaticOlderPage(
                  userIsScrolling: userIsScrolling,
                  isNearTop: isNearTop,
                  hasMore: workspaces.transcriptHasMore,
                  isLoading: workspaces.transcriptLoading || workspaces.transcriptLoadingOlder
                ) else { return }
          Task { @MainActor in
            workspaces.loadOlderMessages(auth: auth)
          }
        }
      }
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
        if workspaces.timeline.failedPage == .older {
          scrollIntent.readOlder()
          workspaces.loadOlderMessages(auth: auth)
        } else {
          workspaces.refreshTranscript(auth: auth)
        }
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

    private func isLiveCoworkerOverlay(_ message: Components.Schemas.ChatRoomMessage) -> Bool {
      message.id.hasPrefix("stream:") && isCoworkerMessage(message)
    }

    private func streamReasoning(for message: Components.Schemas.ChatRoomMessage) -> String? {
      guard isLiveCoworkerOverlay(message) else { return nil }
      if ComposerContent(message.content).text.isEmpty, workspaces.directStream.isBusy {
        return workspaces.directStream.latestThought ?? workspaces.directStream.reasoning
      }
      return workspaces.directStream.reasoning
    }
  }

#endif

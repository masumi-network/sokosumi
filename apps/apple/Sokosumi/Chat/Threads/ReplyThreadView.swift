import CoreAPI
import SokosumiAuth
import SokosumiChat
import SokosumiWorkspace
import SwiftUI

#if os(macOS)
  struct ReplyThreadView: View {
    @EnvironmentObject private var workspaces: WorkspaceState
    @EnvironmentObject private var auth: AuthState
    @State private var followsLatest = true
    @State private var userIsScrolling = false
    @State private var pendingQuote: Components.Schemas.ChatRoomMessageQuote?
    @State private var quoteTarget: String?
    @State private var quoteFocusRequest: String?

    var body: some View {
      if let parent = workspaces.thread.parent {
        VStack(spacing: 0) {
          ScrollViewReader { proxy in
            ScrollView {
              VStack(alignment: .leading, spacing: 8) {
                MessageRowView(channels: workspaces.composerChannels, room: workspaces.rooms.first { $0.id == workspaces.transcriptRoomId }, message: parent, isContinuation: false, outbound: nil, onRetry: nil, onRemove: nil,
                               onQuote: canQuoteMessage(parent) ? { pendingQuote = messageQuote(from: parent)
                                 quoteFocusRequest = UUID().uuidString
                               } : nil,
                               onEdit: canEditMessage(parent, userId: workspaces.currentUserId) ? { workspaces.startEditing(parent) } : nil,
                               editing: workspaces.messageEditing,
                               onQuoteJump: { quoteTarget = $0 })
                  .id(parent.id)
                Divider()
                Text("^[\(parent.threadReplyCount) reply](inflect: true)").font(.caption).foregroundStyle(.secondary)
                replies
                Color.clear.frame(height: 17).id("thread-bottom")
              }
              .padding(.horizontal)
              .padding(.top)
            }
            .defaultScrollAnchor(.bottom, for: .initialOffset)
            .onChange(of: quoteTarget) { _, target in
              guard let target else { return }
              quoteTarget = nil
              guard parent.id == target || workspaces.displayedThreadReplies.contains(where: { $0.id == target }) else { return }
              followsLatest = false
              proxy.scrollTo(target, anchor: .center)
            }
            .onScrollPhaseChange { _, phase in userIsScrolling = phase == .interacting || phase == .decelerating }
            .onScrollGeometryChange(for: Double.self) { geometry in
              geometry.contentSize.height - geometry.visibleRect.maxY
            } action: { _, distanceFromBottom in
              if userIsScrolling {
                followsLatest = distanceFromBottom < 200
              } else if followsLatest, distanceFromBottom > 1 {
                proxy.scrollTo("thread-bottom", anchor: .bottom)
              }
            }
            .onChange(of: workspaces.displayedThreadReplies.last?.id) { _, _ in
              if followsLatest {
                proxy.scrollTo("thread-bottom", anchor: .bottom)
              }
            }
            .overlay(alignment: .bottomTrailing) {
              if !followsLatest {
                Button("Latest reply", systemImage: "arrow.down") {
                  followsLatest = true
                  proxy.scrollTo("thread-bottom", anchor: .bottom)
                }
                .padding()
              }
            }
          }
          ChatComposerView(userId: workspaces.currentUserId, organizationId: workspaces.selection?.workspace.organizationId,
                           roomId: parent.roomId, parentMessageId: parent.id, pendingQuote: $pendingQuote, quoteFocusRequest: quoteFocusRequest,
                           onAccepted: { followsLatest = true })
            .id(parent.id)
        }
        .navigationTitle("Thread")
        .onChange(of: parent.id) { _, _ in pendingQuote = nil
          quoteTarget = nil
        }
      }
    }

    @ViewBuilder private var replies: some View {
      let timeline = workspaces.thread.timeline
      if timeline.isLoading {
        ProgressView("Loading replies…")
      } else {
        if timeline.hasMore {
          Button("Load older replies") {
            followsLatest = false
            workspaces.loadThreadPage(.older, auth: auth)
          }
          .disabled(timeline.isLoadingOlder || workspaces.directStream.isBusy)
        }
        if timeline.isLoadingOlder {
          ProgressView()
        }
        if let error = timeline.errorMessage {
          Text(error).foregroundStyle(.secondary)
          Button("Retry") { workspaces.loadThreadPage(timeline.failedPage ?? .initial, auth: auth) }
        }
        if workspaces.directStream.parentMessageId == workspaces.thread.parent?.id,
           let error = workspaces.directStream.errorMessage {
          Text(error).foregroundStyle(.secondary)
        }
        let messages = workspaces.displayedThreadReplies
        if messages.isEmpty, timeline.errorMessage == nil {
          Text("No replies yet.").foregroundStyle(.secondary)
        }
        ForEach(Array(messages.enumerated()), id: \.element.id) { index, message in
          let previous = index > 0 ? messages[index - 1] : nil
          let streaming = message.id.hasPrefix("stream:") && isCoworkerMessage(message)
          let thinking = streaming && message.content.isEmpty && workspaces.directStream.isBusy
          let reasoning = thinking ? (workspaces.directStream.latestThought ?? workspaces.directStream.reasoning) : workspaces.directStream.reasoning
          let outbox = workspaces.thread.outbox
          let shell = outbox.shells.first { $0.id == message.id }
          VStack(alignment: .leading, spacing: 0) {
            if let label = daySeparatorLabel(for: message.createdAt, previous: previous?.createdAt) {
              DaySeparatorRow(label: label)
            }
            if let status = membershipStatusText(message) {
              MembershipStatusRow(text: status)
            } else {
              MessageRowView(channels: workspaces.composerChannels, room: workspaces.rooms.first { $0.id == workspaces.transcriptRoomId }, message: message, isContinuation: isMessageContinuation(previous: previous, current: message),
                             outbound: shell, sentAt: outbox.sentAt[message.id],
                             onRetry: shell.map { item in { outbox.retry(item.clientTurnId) } },
                             onRemove: shell.map { item in { outbox.remove(item.clientTurnId) } },
                             onQuote: canQuoteMessage(message) ? { pendingQuote = messageQuote(from: message)
                               quoteFocusRequest = UUID().uuidString
                             } : nil,
                             onEdit: canEditMessage(message, userId: workspaces.currentUserId) ? { workspaces.startEditing(message) } : nil,
                             editing: workspaces.messageEditing,
                             onQuoteJump: { quoteTarget = $0 },
                             streamReasoning: streaming ? reasoning : nil, streamThinking: thinking)
            }
          }
          .id(message.id)
        }
      }
    }
  }
#endif

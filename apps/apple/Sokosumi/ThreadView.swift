import CoreAPI
import SokosumiAuth
import SokosumiChat
import SwiftUI

#if os(macOS)
  struct ThreadView: View {
    @EnvironmentObject private var workspaces: WorkspaceState
    @EnvironmentObject private var auth: AuthState
    @State private var followsLatest = true
    @State private var userIsScrolling = false

    var body: some View {
      if let parent = workspaces.thread.parent {
        VStack(spacing: 0) {
          ScrollViewReader { proxy in
            ScrollView {
              VStack(alignment: .leading, spacing: 8) {
                MessageRow(message: parent, isContinuation: false, outbound: nil, onRetry: nil, onRemove: nil)
                Divider()
                Text("^[\(parent.threadReplyCount) reply](inflect: true)").font(.caption).foregroundStyle(.secondary)
                replies
                Color.clear.frame(height: 17).id("thread-bottom")
              }
              .padding(.horizontal)
              .padding(.top)
            }
            .defaultScrollAnchor(.bottom, for: .initialOffset)
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
            .onChange(of: workspaces.thread.displayedReplies.last?.id) { _, _ in
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
          Divider()
          ChatComposer(userId: workspaces.currentUserId, organizationId: workspaces.selection?.workspace.organizationId,
                       roomId: parent.roomId, parentMessageId: parent.id,
                       onAccepted: { followsLatest = true })
            .id(parent.id)
        }
        .navigationTitle("Thread")
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
          .disabled(timeline.isLoadingOlder)
        }
        if timeline.isLoadingOlder {
          ProgressView()
        }
        if let error = timeline.errorMessage {
          Text(error).foregroundStyle(.secondary)
          Button("Retry") { workspaces.loadThreadPage(timeline.failedPage ?? .initial, auth: auth) }
        }
        let messages = workspaces.thread.displayedReplies
        if messages.isEmpty, timeline.errorMessage == nil {
          Text("No replies yet.").foregroundStyle(.secondary)
        }
        ForEach(Array(messages.enumerated()), id: \.element.id) { index, message in
          let previous = index > 0 ? messages[index - 1] : nil
          let outbox = workspaces.thread.outbox
          let shell = outbox.shells.first { $0.id == message.id }
          VStack(alignment: .leading, spacing: 0) {
            if let label = daySeparatorLabel(for: message.createdAt, previous: previous?.createdAt) {
              DaySeparatorRow(label: label)
            }
            if let status = membershipStatusText(message) {
              MembershipStatusRow(text: status)
            } else {
              MessageRow(message: message, isContinuation: isMessageContinuation(previous: previous, current: message),
                         outbound: shell, sentAt: outbox.sentAt[message.id],
                         onRetry: shell.map { item in { outbox.retry(item.clientTurnId) } },
                         onRemove: shell.map { item in { outbox.remove(item.clientTurnId) } })
            }
          }
          .id(message.id)
        }
      }
    }
  }
#endif

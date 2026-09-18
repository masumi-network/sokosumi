import CoreAPI
import SokosumiAuth
import SokosumiChat
import SokosumiWorkspace
import SwiftUI

#if os(macOS)
  /// One native inspector shared by room search, pins, threads and members.
  struct RoomToolsModifier: ViewModifier {
    let roomId: String
    let jump: (String) async throws -> MessageNavigationResult
    @EnvironmentObject private var workspaces: WorkspaceState
    @EnvironmentObject private var auth: AuthState
    @StateObject private var search = RoomSearch()
    @State private var showsSearch = false
    @State private var showsPins = false
    @State private var showsThreads = false
    @State private var showsMembers = false
    @State private var query = ""
    @State private var selectedId: String?
    @State private var jumpingId: String?
    @State private var jumpError: String?
    @State private var retry = 0
    @State private var jumpRequestId: UUID?
    @State private var jumpTask: Task<Void, Never>?

    private var room: Components.Schemas.ChatRoom? {
      workspaces.rooms.first { $0.id == roomId }
    }

    private var scope: [String] {
      [workspaces.currentUserId, workspaces.selectionId ?? "", roomId, String(workspaces.timeline.generation)]
    }

    private var request: [String] {
      scope + [showsSearch ? query : "", String(retry), String(showsSearch)]
    }

    func body(content: Content) -> some View {
      content
        .toolbar { roomToolbar }
        .inspector(isPresented: inspectorPresented) {
          inspectorContent
            .inspectorColumnWidth(min: 280, ideal: 340, max: 420)
        }
        .task(id: scope + [String(showsThreads), workspaces.thread.parent?.id ?? ""]) {
          guard showsThreads, workspaces.thread.parent == nil else { return }
          await workspaces.updateThreadOverview(.load, roomId: roomId, auth: auth)
        }
        .task(id: scope + [String(workspaces.threadAttentionRevision), String(showsThreads), workspaces.thread.parent?.id ?? ""]) {
          do { try await Task.sleep(for: .milliseconds(150)) } catch { return }
          await workspaces.updateThreadOverview(.count, roomId: roomId, auth: auth)
        }
        .task(id: scope + [String(showsThreads)]) {
          await workspaces.refreshChatDisplayPreferences(auth: auth)
        }
        .task(id: request) {
          jumpError = nil
          selectedId = nil
          guard showsSearch else { search.reset()
            return
          }
          await workspaces.searchMessages(query, roomId: roomId, search: search, auth: auth)
          guard !Task.isCancelled else { return }
          selectedId = search.results.first?.id
        }
        .onChange(of: scope) { _, _ in
          closeSearch()
          showsPins = false
          showsThreads = false
          showsMembers = false
          query = ""
          jumpingId = nil
          jumpError = nil
        }
    }

    @ViewBuilder
    private var inspectorContent: some View {
      if let room, showsMembers {
        RoomDetailsView(room: room, close: { showsMembers = false })
      } else if showsThreads {
        RoomThreadOverviewView(overview: workspaces.threadOverview, open: {
          workspaces.openThread($0, auth: auth)
        }, older: { updateThreads(.older) }, markAllRead: { updateThreads(.markAllRead) },
        retry: { updateThreads(.load) }, close: { showsThreads = false })
      } else if showsSearch {
        RoomSearchResultsView(search: search, query: query, selectedId: $selectedId,
                              jumpingId: jumpingId, jumpError: jumpError,
                              select: select, retry: { retry += 1 }, close: closeSearch)
      } else if let room, showsPins {
        PinnedMessagesView(pins: workspaces.pins, room: room, jump: jump, close: { showsPins = false })
      }
    }

    private var inspectorPresented: Binding<Bool> {
      Binding(
        get: {
          roomToolsInspectorPresented(
            showsPins: showsPins,
            showsMembers: showsMembers,
            showsSearch: showsSearch,
            showsThreads: showsThreads,
            threadParentId: workspaces.thread.parent?.id
          )
        },
        set: {
          if !$0 {
            showsPins = false
            showsMembers = false
            if roomToolsClearsThreadsOnInspectorDismiss(threadParentId: workspaces.thread.parent?.id) {
              showsThreads = false
            }
            closeSearch()
          }
        }
      )
    }

    @ToolbarContentBuilder
    private var roomToolbar: some ToolbarContent {
      ToolbarItem {
        HStack(spacing: 6) {
          Button("Find in conversation", systemImage: "magnifyingglass") {
            if showsSearch {
              closeSearch()
            } else {
              showsMembers = false
              showsSearch = true
              showsPins = false
              showsThreads = false
            }
          }
          .keyboardShortcut("f", modifiers: .command)
          .help("Find in conversation (⌘F)")
          if showsSearch {
            RoomSearchField(query: $query, isJumping: jumpingId != nil,
                            submit: selectCurrentResult, move: moveSelection, close: closeSearch)
          }
        }
      }
      ToolbarItem {
        Button {
          showsMembers = false
          showsThreads.toggle()
          showsPins = false
          closeSearch()
        } label: {
          HStack(spacing: 4) {
            Image(systemName: "bubble.left.and.bubble.right")
            if workspaces.threadOverview.unreadCount > 0 {
              if workspaces.chatDisplay.showsRoomUnreadCount {
                Text(roomCountLabel(workspaces.threadOverview.unreadCount))
                  .font(.caption).monospacedDigit()
              } else {
                Circle().fill(Color.accentColor).frame(width: 6, height: 6)
              }
            }
          }
        }
        .help("Threads")
        .accessibilityLabel(roomThreadsAccessibilityLabel(unreadCount: workspaces.threadOverview.unreadCount))
        .accessibilityValue(showsThreads && workspaces.thread.parent == nil ? "Expanded" : "Collapsed")
      }
      if let room, RoomRoster.isAvailable(in: room) {
        ToolbarItem {
          Button("Members", systemImage: "person.2") {
            showsMembers.toggle()
            showsPins = false
            showsThreads = false
            closeSearch()
          }
          .help("Members")
          .accessibilityValue(showsMembers ? "Expanded" : "Collapsed")
        }
      }
      if room?.kind == .channel {
        ToolbarItem {
          Button("Pinned messages", systemImage: "pin") {
            showsMembers = false
            showsPins.toggle()
            showsThreads = false
            closeSearch()
          }.help("Pinned messages")
        }
      }
    }

    private func updateThreads(_ action: WorkspaceState.ThreadOverviewAction) {
      Task { await workspaces.updateThreadOverview(action, roomId: roomId, auth: auth) }
    }

    private func closeSearch() {
      jumpTask?.cancel()
      jumpTask = nil
      jumpRequestId = nil
      jumpingId = nil
      showsSearch = false
    }

    private func moveSelection(_ direction: Int) {
      let rows = search.results
      guard !rows.isEmpty else { return }
      let index = rows.firstIndex { $0.id == selectedId } ?? (direction > 0 ? -1 : 0)
      selectedId = rows[(index + direction + rows.count) % rows.count].id
    }

    private func selectCurrentResult() {
      guard let hit = search.results.first(where: { $0.id == selectedId }) else { return }
      select(hit)
    }

    private func select(_ hit: Components.Schemas.ChatRoomMessage) {
      guard jumpingId == nil, !search.isLoading, search.query == query.trimmingCharacters(in: .whitespacesAndNewlines) else { return }
      jumpingId = hit.id
      jumpError = nil
      let expectedScope = scope
      let requestId = UUID()
      jumpRequestId = requestId
      jumpTask = Task { @MainActor in
        defer {
          if expectedScope == scope, jumpRequestId == requestId {
            jumpingId = nil
          }
        }
        do {
          let result = if hit.parentMessageId != nil {
            try await workspaces.openMessageReply(hit, auth: auth)
          } else {
            try await jump(hit.id)
          }
          guard expectedScope == scope, jumpRequestId == requestId, !Task.isCancelled else { return }
          switch result {
          case .opened:
            showsSearch = false
          case .unavailable:
            jumpError = "This message is no longer available."
          case .superseded:
            break
          }
        } catch {
          if expectedScope == scope, jumpRequestId == requestId, !Task.isCancelled {
            jumpError = friendlyMessage(for: error)
          }
        }
      }
    }
  }

  func roomThreadsAccessibilityLabel(unreadCount: Int) -> String {
    guard unreadCount > 0 else { return "Threads" }
    if unreadCount > 99 {
      return "Threads, more than 99 unread"
    }
    return "Threads, \(unreadCount) unread"
  }

  func roomToolsInspectorPresented(
    showsPins: Bool,
    showsMembers: Bool = false,
    showsSearch: Bool,
    showsThreads: Bool,
    threadParentId: String?
  ) -> Bool {
    (showsPins || showsMembers || showsSearch || showsThreads) && threadParentId == nil
  }

  func roomToolsClearsThreadsOnInspectorDismiss(threadParentId: String?) -> Bool {
    threadParentId == nil
  }
#endif

import CoreAPI
import SokosumiAuth
import SokosumiChat
import SokosumiWorkspace
import SwiftUI

#if os(macOS)
  /// One native inspector shared by room search, pins, threads and members.
  enum RoomToolsInspectorDestination: Equatable {
    case search
    case pins
    case threads
    case members
  }

  struct RoomToolsModifier: ViewModifier {
    let roomId: String
    let jump: (String) async throws -> MessageNavigationResult
    @EnvironmentObject private var workspaces: WorkspaceState
    @EnvironmentObject private var auth: AuthState
    @StateObject private var search = RoomSearch()
    @State private var destination: RoomToolsInspectorDestination?
    @State private var query = ""
    @State private var jumpingId: String?
    @State private var jumpError: String?
    @State private var retry = 0
    @State private var jumpRequestId: UUID?
    @State private var jumpTask: Task<Void, Never>?

    /// How long the Threads trigger waits before it counts, so a burst of attention bumps sends one request.
    static let threadsCountDebounce: Duration = .milliseconds(150)

    private var room: Components.Schemas.ChatRoom? {
      workspaces.rooms.first { $0.id == roomId }
    }

    private var scope: [String] {
      [workspaces.currentUserId, workspaces.selectionId ?? "", roomId, String(workspaces.timeline.generation)]
    }

    private var request: [String] {
      let searching = destination == .search
      return scope + [searching ? query : "", String(retry), String(searching)]
    }

    func body(content: Content) -> some View {
      content
        .toolbar { roomToolbar }
        .inspector(isPresented: inspectorPresented) {
          inspectorContent
            .inspectorColumnWidth(min: 280, ideal: 340, max: 420)
        }
        .task(id: scope + [String(destination == .threads), workspaces.thread.parent?.id ?? ""]) {
          guard destination == .threads, workspaces.thread.parent == nil else { return }
          await workspaces.updateThreadOverview(.load, roomId: roomId, auth: auth)
        }
        .task(id: scope + [String(workspaces.threadAttentionRevision), String(destination == .threads), workspaces.thread.parent?.id ?? ""]) {
          do { try await Task.sleep(for: Self.threadsCountDebounce) } catch { return }
          await workspaces.updateThreadOverview(.count, roomId: roomId, auth: auth)
        }
        .task(id: scope + [String(destination == .threads)]) {
          await workspaces.refreshChatDisplayPreferences(auth: auth)
        }
        .task(id: request) {
          jumpError = nil
          guard destination == .search else { search.reset()
            return
          }
          await workspaces.searchMessages(query, roomId: roomId, search: search, auth: auth)
        }
        .onChange(of: scope) { _, _ in
          cancelJump()
          destination = nil
          query = ""
          jumpError = nil
        }
    }

    @ViewBuilder
    private var inspectorContent: some View {
      if let shownDestination = destination {
        switch shownDestination {
        case .members:
          if let room {
            RoomDetailsView(room: room, close: { destination = nil })
          }
        case .threads:
          RoomThreadOverviewView(overview: workspaces.threadOverview, open: {
            workspaces.openThread($0, auth: auth)
          }, older: { updateThreads(.older) }, markAllRead: { updateThreads(.markAllRead) },
          retry: { updateThreads(.load) }, close: { destination = nil })
        case .search:
          RoomSearchResultsView(search: search, query: query,
                                jumpingId: jumpingId, jumpError: jumpError,
                                select: select, retry: { retry += 1 }, close: closeSearch)
        case .pins:
          if let room {
            PinnedMessagesView(pins: workspaces.pins, room: room, jump: jump, close: { destination = nil })
          }
        }
      }
    }

    private var inspectorPresented: Binding<Bool> {
      Binding(
        get: {
          roomToolsInspectorPresented(
            destination: destination,
            threadParentId: workspaces.thread.parent?.id
          )
        },
        set: {
          if !$0 {
            destination = roomToolsInspectorDestinationAfterDismiss(
              destination,
              threadParentId: workspaces.thread.parent?.id
            )
            cancelJump()
          }
        }
      )
    }

    @ToolbarContentBuilder
    private var roomToolbar: some ToolbarContent {
      ToolbarItem {
        HStack(spacing: 6) {
          Button("Find in conversation", systemImage: "magnifyingglass") {
            selectDestination(.search)
          }
          .keyboardShortcut("f", modifiers: .command)
          .help("Find in conversation (⌘F)")
          if destination == .search {
            RoomSearchField(query: $query, isJumping: jumpingId != nil,
                            submit: selectCurrentResult, move: search.moveSelection(by:), close: closeSearch)
          }
        }
      }
      ToolbarItem {
        Button {
          selectDestination(.threads)
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
        .accessibilityValue(destination == .threads && workspaces.thread.parent == nil ? "Expanded" : "Collapsed")
      }
      if let room, RoomRoster.isAvailable(in: room) {
        ToolbarItem {
          Button("Members", systemImage: "person.2") {
            selectDestination(.members)
          }
          .help("Members")
          .accessibilityValue(destination == .members ? "Expanded" : "Collapsed")
        }
      }
      if room?.kind == .channel {
        ToolbarItem {
          Button("Pinned messages", systemImage: "pin") {
            selectDestination(.pins)
          }.help("Pinned messages")
        }
      }
    }

    private func updateThreads(_ action: WorkspaceState.ThreadOverviewAction) {
      Task { await workspaces.updateThreadOverview(action, roomId: roomId, auth: auth) }
    }

    private func cancelJump() {
      jumpTask?.cancel()
      jumpTask = nil
      jumpRequestId = nil
      jumpingId = nil
    }

    private func closeSearch() {
      cancelJump()
      if destination == .search {
        destination = nil
      }
    }

    private func selectDestination(_ next: RoomToolsInspectorDestination) {
      if destination == .search {
        cancelJump()
      }
      destination = destination == next ? nil : next
    }

    private func selectCurrentResult() {
      guard let hit = search.selectedResult else { return }
      select(hit)
    }

    private func select(_ hit: Components.Schemas.ChatRoomMessage) {
      // Web opens a hit that is still showing even while a refined query is pending.
      guard jumpingId == nil, search.presentation(for: query).results.contains(where: { $0.id == hit.id }) else { return }
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
            if destination == .search {
              destination = nil
            }
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
    destination: RoomToolsInspectorDestination?,
    threadParentId: String?
  ) -> Bool {
    destination != nil && threadParentId == nil
  }

  func roomToolsInspectorDestinationAfterDismiss(
    _ destination: RoomToolsInspectorDestination?,
    threadParentId: String?
  ) -> RoomToolsInspectorDestination? {
    if destination == .threads, threadParentId != nil {
      return .threads
    }
    return nil
  }
#endif

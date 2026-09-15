import CoreAPI
import SokosumiAuth
import SokosumiChat
import SokosumiWorkspace
import SwiftUI

#if os(macOS)
  /// One native inspector shared by room search and pins.
  struct RoomToolsModifier: ViewModifier {
    let roomId: String
    let jump: (String) async throws -> Bool
    @EnvironmentObject private var workspaces: WorkspaceState
    @EnvironmentObject private var auth: AuthState
    @StateObject private var search = RoomSearch()
    @State private var showsSearch = false
    @State private var showsPins = false
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
        .inspector(isPresented: Binding(get: { showsPins || showsSearch }, set: {
          if !$0 {
            showsPins = false
            closeSearch()
          }
        })) {
          Group {
            if showsSearch {
              RoomSearchResultsView(search: search, query: query, selectedId: $selectedId,
                                    jumpingId: jumpingId, jumpError: jumpError,
                                    select: select, retry: { retry += 1 }, close: closeSearch)
            } else if let room, showsPins {
              PinnedMessagesView(pins: workspaces.pins, room: room, jump: jump, close: { showsPins = false })
            }
          }
          .inspectorColumnWidth(min: 280, ideal: 340, max: 420)
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
          query = ""
          jumpingId = nil
          jumpError = nil
        }
    }

    @ToolbarContentBuilder
    private var roomToolbar: some ToolbarContent {
      ToolbarItem {
        HStack(spacing: 6) {
          Button("Find in conversation", systemImage: "magnifyingglass") {
            if showsSearch {
              closeSearch()
            } else {
              showsSearch = true
              showsPins = false
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
      if room?.kind == .channel {
        ToolbarItem {
          Button("Pinned messages", systemImage: "pin") {
            showsPins.toggle()
            closeSearch()
          }.help("Pinned messages")
        }
      }
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
          let success = if hit.parentMessageId != nil {
            try await workspaces.openSearchReply(hit, auth: auth)
          } else {
            try await jump(hit.id)
          }
          guard expectedScope == scope, jumpRequestId == requestId, !Task.isCancelled else { return }
          if success {
            showsSearch = false
          } else {
            jumpError = "Couldn’t jump to this message. Try again."
          }
        } catch {
          if expectedScope == scope, jumpRequestId == requestId, !Task.isCancelled {
            jumpError = friendlyMessage(for: error)
          }
        }
      }
    }
  }
#endif

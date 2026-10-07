#if os(macOS)
  import AppKit
  import CoreAPI
  @testable import Sokosumi
  import SokosumiAuth
  import SokosumiChat
  import SokosumiWorkspace
  import SwiftUI
  import Testing

  extension NativeWindowTests {
    /// Row 31c: the title bar's room name reaches the window's one Channel settings sheet, its Members inspector or
    /// its Name Group sheet — the places the sidebar row menu and the inspector already open — as web's header title
    /// opens its shell's dialog or members panel (`rooms-client.tsx`:2135-2152, :1982-1985).
    @MainActor struct RoomTitleRoutingTests {
      /// The room pane as `ChatRootView` hosts it: the room's toolbar owner inside the window's sheet host.
      private static func open(_ room: Components.Schemas.ChatRoom, isOwnerOrAdmin: Bool) async throws -> (NSWindow, WorkspaceState) {
        let state = WorkspaceState()
        state.rooms = [room]
        await state.archivedChannels.load { ArchivedChannelList(rooms: [], canDelete: isOwnerOrAdmin) }
        let window = try await SceneWindow.open(width: 900, height: 420, dark: false) {
          NavigationSplitView {
            List { Text("Channels") }
          } detail: {
            NavigationStack {
              Color(nsColor: .windowBackgroundColor)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .modifier(RoomToolsModifier(roomId: room.id, jump: { _ in .unavailable }))
            }
          }
          .modifier(RoomEditSheetsHost())
          .environmentObject(state)
          .environmentObject(AuthState())
        } ready: { RoomHeaderTests.headerItems(in: $0).first?.view != nil }
        return (window, state)
      }

      /// The split views' expanded panes: the sidebar and the room, and the inspector once it shows.
      private static func paneCount(in window: NSWindow) -> Int {
        func splitViews(_ view: NSView) -> [NSSplitView] {
          ((view as? NSSplitView).map { [$0] } ?? []) + view.subviews.flatMap(splitViews)
        }
        let frame = window.contentView?.superview ?? NSView()
        return splitViews(frame).compactMap { ($0.delegate as? NSSplitViewController)?.splitViewItems.count(where: { !$0.isCollapsed }) }
          .reduce(0, +)
      }

      private static func clickTheName(_ room: Components.Schemas.ChatRoom, isOwnerOrAdmin: Bool) async throws -> RoomTitleDestination {
        let (window, _) = try await open(room, isOwnerOrAdmin: isOwnerOrAdmin)
        defer {
          if let sheet = window.attachedSheet {
            window.endSheet(sheet)
          }
          window.close()
        }
        let panes = paneCount(in: window)
        try RoomHeaderTests.click(RoomHeaderTests.namePoint(in: window), in: window)
        let clock = ContinuousClock()
        let deadline = clock.now.advanced(by: .seconds(3))
        while clock.now < deadline {
          if window.attachedSheet != nil {
            return .sheet
          }
          if paneCount(in: window) > panes {
            return .inspector
          }
          try await Task.sleep(for: .milliseconds(20))
        }
        return .nothing
      }

      @Test func anOwnerOrAdminsChannelNameOpensTheSettingsSheet() async throws {
        let room = RoomHeaderTests.room("launch", topic: "Weekly launch planning")
        #expect(try await Self.clickTheName(room, isOwnerOrAdmin: true) == .sheet)
      }

      /// Anyone else's Channel name, and an owner's before the role is read, opens the Members inspector.
      @Test(arguments: [
        RoomHeaderTests.room("launch", topic: "Weekly launch planning"),
        RoomHeaderTests.room("acme-partners", discoverability: .external, access: .guest)
      ])
      func aMembersChannelNameOpensTheMembersInspector(room: Components.Schemas.ChatRoom) async throws {
        #expect(try await Self.clickTheName(room, isOwnerOrAdmin: false) == .inspector)
      }

      @Test func aGroupDirectsNameOpensTheNameGroupSheet() async throws {
        #expect(try await Self.clickTheName(RoomHeaderTests.groupDirect, isOwnerOrAdmin: false) == .sheet)
      }

      @Test func aOneToOneDirectsNameOpensNothing() async throws {
        #expect(try await Self.clickTheName(RoomHeaderTests.room("dm", kind: .direct), isOwnerOrAdmin: true) == .nothing)
      }
    }
  }

  /// What a click on the name brought up.
  private enum RoomTitleDestination: Equatable {
    case sheet
    case inspector
    case nothing
  }
#endif

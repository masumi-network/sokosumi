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
    /// Rows 31a and 31c: the room header in the window's title bar — the Channel glyph (matched as External), a
    /// Direct's message glyph or a Self Direct's face, the room's name and a Channel's topic — and the name as the
    /// button web's header title is, for a Channel and a group Direct.
    @MainActor struct RoomHeaderTests {
      private nonisolated static let created = Date(timeIntervalSince1970: 1_790_000_000)
      private nonisolated static let reader = "user_reader"
      /// The title bar band the render keeps, in points.
      private static let titleBarHeight: CGFloat = 56
      private static let longTopic =
        "Weekly launch planning, release notes, the go/no-go call and everything the support rota needs to know"

      private nonisolated static func person(_ id: String, _ name: String) -> Components.Schemas.ChatRoomUserParticipant {
        .init(id: id, name: name, email: "\(id)@example.com", image: nil, presence: .offline)
      }

      nonisolated static func room(
        _ name: String, topic: String? = nil,
        discoverability: Components.Schemas.ChatRoom.DiscoverabilityPayload? = ._public,
        kind: Components.Schemas.ChatRoom.KindPayload = .channel,
        access: Components.Schemas.ChatRoomAccess = .member,
        members: [Components.Schemas.ChatRoomUserParticipant]? = nil
      ) -> Components.Schemas.ChatRoom {
        let members = members ?? [person(reader, "Me"), person("user_ada", "Ada Lovelace")]
        return .init(
          id: "550e8400-e29b-41d4-a716-446655440131", organizationId: "org_1", name: name, kind: kind, isSelfDirect: false,
          isGroupDirect: kind == .direct && members.count > 2, isReadOnly: false,
          topic: topic, discoverability: kind == .channel ? discoverability : nil, createdByUserId: "user_ada",
          createdAt: created, updatedAt: created, unreadCount: 0, unreadMentionCount: 0, markedUnread: false,
          myAccess: .init(value1: access, value2: .init(stringLiteral: access.rawValue)),
          userMembers: members, formerUserMembers: [], coworkerMembers: [], sokoBotMembers: []
        )
      }

      nonisolated static var groupDirect: Components.Schemas.ChatRoom {
        room("Ada, Grace", kind: .direct, members: [person(reader, "Me"), person("user_ada", "Ada"), person("user_grace", "Grace")])
      }

      nonisolated static var selfDirect: Components.Schemas.ChatRoom {
        var room = room("Direct", kind: .direct, members: [person(reader, "Ada Lovelace")])
        room.isSelfDirect = true
        return room
      }

      private static func identity(_ room: Components.Schemas.ChatRoom, isOwnerOrAdmin: Bool = false) -> RoomHeaderIdentity {
        RoomHeaderIdentity(room: room, currentUserId: reader, isOwnerOrAdmin: isOwnerOrAdmin)
      }

      /// The header as the app hosts it: the room pane's `NavigationStack` in a split view's detail column, in a
      /// window of a real SwiftUI scene, so the window's title and subtitle come from the navigation title and the
      /// title bar is drawn as in the app. `tools` adds the room's four toolbar buttons beside it, and `searching`
      /// Find's search field after its button, as `RoomToolsModifier` draws them.
      private static func window(
        _ identity: RoomHeaderIdentity, dark: Bool, width: CGFloat = 640, tools: Bool = false, searching: Bool = false,
        sidebar: Bool = true,
        open: @escaping (RoomHeaderIdentity.TitleAction) -> Void = { _ in }
      ) async throws -> NSWindow {
        try await SceneWindow.open(width: width, height: 140, dark: dark) {
          NavigationSplitView(columnVisibility: .constant(sidebar ? .all : .detailOnly)) {
            List { Text("Channels") }
          } detail: {
            NavigationStack {
              Color(nsColor: .windowBackgroundColor)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .toolbar {
                  if tools {
                    ToolbarItem {
                      HStack(spacing: 6) {
                        Button("Find in conversation", systemImage: "magnifyingglass") {}
                        if searching {
                          RoomSearchField(query: .constant(""), isJumping: false, submit: {}, move: { _ in }, close: {})
                        }
                      }
                    }
                    ToolbarItem { Button("Threads", systemImage: "bubble.left.and.bubble.right") {} }
                    ToolbarItem { Button("Members", systemImage: "person.2") {} }
                    ToolbarItem { Button("Pinned messages", systemImage: "pin") {} }
                  }
                }
                .modifier(RoomHeaderModifier(identity: identity, searching: searching, open: open))
            }
          }
        } ready: { headerItems(in: $0).first?.view != nil }
      }

      /// The title bar's items other than the window's and SwiftUI's own (toggle, separator, spaces, Back).
      static func headerItems(in window: NSWindow) -> [NSToolbarItem] {
        let system: Set<NSToolbarItem.Identifier> = [.toggleSidebar, .sidebarTrackingSeparator, .flexibleSpace, .space]
        return (window.toolbar?.items ?? []).filter {
          // SwiftUI's own items: the split view's toggle and separator, a pushed view's Back button.
          !system.contains($0.itemIdentifier) && !$0.itemIdentifier.rawValue.hasPrefix("com.apple.SwiftUI.")
        }
      }

      /// A point on the room's name, in window coordinates: past the mark at the room pane's leading edge (or the
      /// window controls with the sidebar collapsed), on the title bar's middle line. Found from the split view, not
      /// from the toolbar items, so a click there can only land on whatever the header draws in the title's place.
      static func namePoint(in window: NSWindow) throws -> NSPoint {
        func splitViews(_ view: NSView) -> [NSSplitView] {
          ((view as? NSSplitView).map { [$0] } ?? []) + view.subviews.flatMap(splitViews)
        }
        let frame = try #require(window.contentView?.superview)
        let split = try #require(splitViews(frame).first, "The window holds the split view.")
        let sidebar = try #require(split.arrangedSubviews.first)
        let paneMinX = sidebar.isHidden || sidebar.frame.width == 0 ? 0 : sidebar.convert(sidebar.bounds, to: nil).maxX
        return NSPoint(x: max(paneMinX, 140) + 50, y: frame.bounds.height - 26)
      }

      /// The header items in the overflow menu once the toolbar has settled: a freshly opened window can report an
      /// item hidden for a moment while it lays out, so wait up to two seconds for that to clear.
      static func overflowedItems(in window: NSWindow) async throws -> [String] {
        let clock = ContinuousClock()
        let deadline = clock.now.advanced(by: .seconds(2))
        var hidden = headerItems(in: window).filter { !$0.isVisible }.map(\.itemIdentifier.rawValue)
        while !hidden.isEmpty, clock.now < deadline {
          try await Task.sleep(for: .milliseconds(50))
          window.contentView?.superview?.layoutSubtreeIfNeeded()
          hidden = headerItems(in: window).filter { !$0.isVisible }.map(\.itemIdentifier.rawValue)
        }
        return hidden
      }

      static func click(_ point: NSPoint, in window: NSWindow) {
        for type in [NSEvent.EventType.leftMouseDown, .leftMouseUp] {
          guard let event = NSEvent.mouseEvent(with: type, location: point, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
                                               windowNumber: window.windowNumber, context: nil, eventNumber: 0, clickCount: 1, pressure: 1) else { continue }
          window.sendEvent(event)
        }
      }

      /// Clicks the room's name and returns what it asked to open.
      private static func clickTheName(_ identity: RoomHeaderIdentity) async throws -> [RoomHeaderIdentity.TitleAction] {
        let opened = OpenedActions()
        let window = try await window(identity, dark: false) { opened.actions.append($0) }
        defer { window.close() }
        try click(namePoint(in: window), in: window)
        try await Task.sleep(for: .milliseconds(200))
        return opened.actions
      }

      /// Row 31c: web wraps the name in a button for a Channel and a group Direct (`room-header-chrome.tsx`:193-253);
      /// a click on it asks for what `RoomHeaderIdentity` says the name opens.
      @Test(arguments: [
        TitleClick(room: RoomHeaderTests.room("launch", topic: "Weekly launch planning"), isOwnerOrAdmin: true, opens: .channelSettings),
        TitleClick(room: RoomHeaderTests.room("launch", topic: "Weekly launch planning"), isOwnerOrAdmin: false, opens: .members),
        TitleClick(room: RoomHeaderTests.room("acme-partners", discoverability: .external, access: .guest), isOwnerOrAdmin: true, opens: .members),
        TitleClick(room: RoomHeaderTests.room("matched-builders", discoverability: .matched), isOwnerOrAdmin: true, opens: .members),
        TitleClick(room: RoomHeaderTests.groupDirect, isOwnerOrAdmin: false, opens: .nameGroup)
      ])
      func clickingTheNameOpensWhatWebsTitleOpens(example: TitleClick) async throws {
        let actions = try await Self.clickTheName(Self.identity(example.room, isOwnerOrAdmin: example.isOwnerOrAdmin))
        #expect(actions == [example.opens])
      }

      /// A one-to-one or Self Direct's name is plain text on web (`room-header-chrome.tsx`:209-215): nothing opens.
      @Test(arguments: [RoomHeaderTests.room("dm", kind: .direct), RoomHeaderTests.selfDirect])
      func aPlainDirectsNameOpensNothing(room: Components.Schemas.ChatRoom) async throws {
        #expect(Self.identity(room).titleAction == nil)
        #expect(try await Self.clickTheName(Self.identity(room)).isEmpty)
      }

      /// The window keeps the name as its title and the topic as its subtitle, for the Window menu and Mission
      /// Control, while the title bar draws the button in their place: the header is one item of its own.
      @Test(arguments: [
        (Components.Schemas.ChatRoom.DiscoverabilityPayload._public, "number"),
        (._private, "lock"),
        (.external, "globe"),
        (.matched, "globe")
      ])
      func aChannelsTitleBarShowsItsGlyphNameAndTopic(example: (Components.Schemas.ChatRoom.DiscoverabilityPayload, String)) async throws {
        let identity = Self.identity(Self.room("launch", topic: "  Weekly launch\nplanning  ", discoverability: example.0))
        let window = try await Self.window(identity, dark: false)
        defer { window.close() }
        #expect(window.title == "launch")
        #expect(window.subtitle == "Weekly launch planning")
        let items = Self.headerItems(in: window).map(\.itemIdentifier.rawValue)
        #expect(items.count == 1, "The title block is the header's one title bar item: \(items)")
        #expect(identity.mark == .channel(ChannelMark(example.0)))
        #expect(ChannelMark(example.0).systemImage == example.1)
      }

      /// A reply Thread pushed over the room gets the window's own title back ("Thread"), with no room name block.
      @Test func aPushedThreadKeepsItsOwnTitle() async throws {
        let thread = ThreadShown()
        let identity = Self.identity(Self.room("launch", topic: "Weekly launch planning"), isOwnerOrAdmin: true)
        let window = try await SceneWindow.open(width: 640, height: 140, dark: false) {
          NavigationSplitView {
            List { Text("Channels") }
          } detail: {
            NavigationStack {
              Color(nsColor: .windowBackgroundColor)
                .modifier(RoomHeaderModifier(identity: identity, searching: false, open: { _ in }))
                .navigationDestination(isPresented: Binding(get: { thread.shown }, set: { thread.shown = $0 })) {
                  Color(nsColor: .windowBackgroundColor).navigationTitle("Thread")
                }
            }
          }
        } ready: { !Self.headerItems(in: $0).isEmpty }
        defer { window.close() }
        thread.shown = true
        let frame = try #require(window.contentView?.superview)
        _ = try await waitForView(in: frame, timeoutMessage: "the Thread's title, now \(window.title)") {
          window.title == "Thread" ? frame : nil
        }
        try await Task.sleep(for: .milliseconds(400))
        #expect(window.titleVisibility == .visible)
        #expect(window.subtitle.isEmpty, "The room's topic left with the room: \(window.subtitle)")
        let shownItems = Self.headerItems(in: window).filter(\.isVisible).map(\.itemIdentifier.rawValue)
        #expect(shownItems.isEmpty, "No room name block over the Thread: \(shownItems)")
      }

      @Test func aChannelWithoutATopicShowsNoSubtitle() async throws {
        let window = try await Self.window(Self.identity(Self.room("general", topic: " \n ")), dark: false)
        defer { window.close() }
        #expect(window.title == "general")
        #expect(window.subtitle.isEmpty)
        #expect(Self.headerItems(in: window).count == 1)
      }

      /// The title block leaves the room's own buttons in the bar: at a narrow window the topic truncates and
      /// Find, Threads, Members and Pinned messages stay visible, as they did beside the window's own title, with
      /// the sidebar shown and with it collapsed, where the title follows the window controls. Every width keeps the
      /// title's cap above its 120 pt minimum (shown, W − 144 − 260; collapsed, W − 140 − 260).
      @Test(arguments: [(560.0, true), (640, true), (560, false), (640, false)])
      func aLongTopicTruncatesBeforeTheRoomsButtonsOverflow(example: (CGFloat, Bool)) async throws {
        let window = try await Self.window(
          Self.identity(Self.room("launch", topic: Self.longTopic)), dark: false, width: example.0, tools: true, sidebar: example.1
        )
        defer { window.close() }
        let items = Self.headerItems(in: window)
        #expect(items.count == 5, "The title and the four room buttons: \(items.map(\.itemIdentifier.rawValue))")
        let hidden = try await Self.overflowedItems(in: window)
        #expect(hidden.isEmpty, "No room button moves into the overflow menu: \(hidden)")
      }

      /// With Find's search field open the title block leaves room for it too: the topic truncates further and the
      /// field and the room's other buttons stay out of the overflow menu, with the sidebar shown and collapsed.
      /// Every width keeps the title's cap above its 120 pt minimum (`titleWidth(in:searching:)`: shown, W − 144 pt
      /// sidebar − 480 pt; collapsed, W − 140 pt window controls − 480 pt), where the allowance is what decides; below
      /// that the block cannot shrink further and whether the buttons fit depends on the machine's toolbar chrome.
      @Test(arguments: [(800.0, true), (900, true), (800, false), (900, false)])
      func aLongTopicLeavesRoomForAnOpenFindField(example: (CGFloat, Bool)) async throws {
        let window = try await Self.window(
          Self.identity(Self.room("launch", topic: Self.longTopic)), dark: false, width: example.0, tools: true, searching: true,
          sidebar: example.1
        )
        defer { window.close() }
        let items = Self.headerItems(in: window)
        #expect(items.count == 5, "The title and the four room buttons: \(items.map(\.itemIdentifier.rawValue))")
        let widths = items.compactMap { $0.view.map { "\($0.frame.width)" } }
        let hidden = try await Self.overflowedItems(in: window)
        #expect(hidden.isEmpty, "No room button moves into the overflow menu: \(hidden), item widths \(widths)")
      }

      /// The recorded picture: each header's title bar band, light beside dark — Channels by viewer, a long topic
      /// beside the room's buttons, the hovered name, a group Direct, a one-to-one Direct and a Self Direct.
      @Test func rendersTheHeaderInLightAndDark() async throws {
        let rows: [RenderRow] = [
          .init(Self.identity(Self.room("general", topic: "Company-wide announcements"), isOwnerOrAdmin: true)),
          .init(Self.identity(Self.room("general", topic: "Company-wide announcements"), isOwnerOrAdmin: true), hovered: true),
          .init(Self.identity(Self.room("leadership", topic: "Owners and admins", discoverability: ._private))),
          .init(Self.identity(Self.room("acme-partners", topic: "Shared with Acme Corp", discoverability: .external, access: .guest))),
          .init(Self.identity(Self.room("matched-builders", topic: "Matched across organizations", discoverability: .matched))),
          .init(Self.identity(Self.room("launch", topic: Self.longTopic)), width: 620, tools: true),
          .init(Self.identity(Self.room("no-topic"))),
          .init(Self.identity(Self.groupDirect), hovered: true),
          .init(Self.identity(Self.room("dm", kind: .direct))),
          .init(Self.identity(Self.selfDirect))
        ]
        var columns: [[CGImage]] = [[], []]
        for (column, dark) in [false, true].enumerated() {
          for row in rows {
            let window = try await Self.window(row.identity, dark: dark, width: row.width, tools: row.tools)
            let frame = try #require(window.contentView?.superview)
            if row.hovered {
              try await hover(frame.convert(Self.namePoint(in: window), from: nil), in: frame, window: window)
            }
            let bitmap = try #require(frame.bitmapImageRepForCachingDisplay(in: frame.bounds))
            frame.cacheDisplay(in: frame.bounds, to: bitmap)
            window.close()
            let image = try #require(bitmap.cgImage)
            let scale = CGFloat(image.width) / frame.bounds.width
            try columns[column].append(#require(image.cropping(to: CGRect(
              x: 0, y: 0, width: CGFloat(image.width), height: (Self.titleBarHeight * scale).rounded()
            ))))
          }
        }
        let combined = try Self.stitched(columns)
        try Attachment.record(#require(combined.representation(using: .png, properties: [:])), named: "room-header-title.png")
        // Nothing renders transparent: the title bar is painted in both appearances.
        for images in columns {
          for image in images {
            let rep = NSBitmapImageRep(cgImage: image)
            let pixel = try #require(rep.colorAt(x: rep.pixelsWide - 4, y: rep.pixelsHigh - 4))
            #expect(pixel.alphaComponent == 1, "Title bar alpha: \(pixel.alphaComponent)")
          }
        }
      }

      /// The columns side by side, top-aligned, 8 px apart over grey; a narrower window's band is left-aligned.
      static func stitched(_ columns: [[CGImage]]) throws -> NSBitmapImageRep {
        let gap = 8
        let columnWidth = try #require(columns[0].map(\.width).max())
        let height = columns[0].reduce(0) { $0 + $1.height + gap } - gap
        let combined = try #require(NSBitmapImageRep(
          bitmapDataPlanes: nil, pixelsWide: columnWidth * columns.count + gap * (columns.count - 1), pixelsHigh: height,
          bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
          bytesPerRow: 0, bitsPerPixel: 0
        ))
        let context = try #require(NSGraphicsContext(bitmapImageRep: combined)).cgContext
        context.setFillColor(NSColor.systemGray.cgColor)
        context.fill(CGRect(x: 0, y: 0, width: combined.pixelsWide, height: height))
        for (column, images) in columns.enumerated() {
          var top = height
          for image in images {
            top -= image.height
            context.draw(image, in: CGRect(x: column * (columnWidth + gap), y: top, width: image.width, height: image.height))
            top -= gap
          }
        }
        return combined
      }
    }
  }

  struct TitleClick: Sendable {
    let room: Components.Schemas.ChatRoom
    let isOwnerOrAdmin: Bool
    let opens: RoomHeaderIdentity.TitleAction
  }

  struct RenderRow {
    let identity: RoomHeaderIdentity
    var width: CGFloat = 640
    var tools = false
    var hovered = false

    init(_ identity: RoomHeaderIdentity, width: CGFloat = 640, tools: Bool = false, hovered: Bool = false) {
      self.identity = identity
      self.width = width
      self.tools = tools
      self.hovered = hovered
    }
  }

  @MainActor @Observable final class ThreadShown {
    var shown = false
  }

  @MainActor final class OpenedActions {
    var actions: [RoomHeaderIdentity.TitleAction] = []
  }

  /// A window of a real SwiftUI scene inside the test host (`NSHostingSceneRepresentation`), so the title bar is the
  /// app's: a hand-built `NSHostingController` window never takes the navigation title.
  @MainActor enum SceneWindow {
    private static var opened = 0

    static func open(
      width: CGFloat, height: CGFloat, dark: Bool, @ViewBuilder content: @escaping () -> some View,
      ready: (NSWindow) -> Bool
    ) async throws -> NSWindow {
      opened += 1
      let id = "scene-window-\(opened)"
      let root = AnyView(content().preferredColorScheme(dark ? .dark : .light))
      let representation = NSHostingSceneRepresentation {
        WindowGroup(id: id) { root }
      }
      NSApp.addSceneRepresentation(representation)
      let before = Set(NSApp.windows.map(ObjectIdentifier.init))
      representation.environment.openWindow(id: id)
      let clock = ContinuousClock()
      var deadline = clock.now.advanced(by: .seconds(5))
      var window: NSWindow?
      while window == nil, clock.now < deadline {
        window = NSApp.windows.first { !before.contains(ObjectIdentifier($0)) && $0.contentView != nil }
        try await Task.sleep(for: .milliseconds(20))
      }
      let shown = try #require(window, "The scene opened a window.")
      shown.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
      shown.setContentSize(NSSize(width: width, height: height))
      deadline = clock.now.advanced(by: .seconds(5))
      while !ready(shown), clock.now < deadline {
        shown.contentView?.superview?.layoutSubtreeIfNeeded()
        try await Task.sleep(for: .milliseconds(20))
      }
      try await Task.sleep(for: .milliseconds(400))
      shown.contentView?.superview?.layoutSubtreeIfNeeded()
      return shown
    }
  }
#endif

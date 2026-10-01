#if os(macOS)
  import AppKit
  import CoreAPI
  @testable import Sokosumi
  import SokosumiChat
  import SwiftUI
  import Testing

  extension NativeWindowTests {
    /// Row 31a: the room header shows web's identity in the window's title bar — the Channel glyph (matched as
    /// External) or a Direct's message glyph, the room's name, and a Channel's topic as the subtitle.
    @MainActor struct RoomHeaderTests {
      private static let created = Date(timeIntervalSince1970: 1_790_000_000)
      /// The title bar band the render keeps, in points.
      private static let titleBarHeight: CGFloat = 56

      private static func room(
        _ name: String, topic: String? = nil,
        discoverability: Components.Schemas.ChatRoom.DiscoverabilityPayload? = ._public,
        kind: Components.Schemas.ChatRoom.KindPayload = .channel
      ) -> Components.Schemas.ChatRoom {
        .init(
          id: "550e8400-e29b-41d4-a716-446655440131", name: name, kind: kind, isSelfDirect: false, isGroupDirect: false,
          topic: topic, discoverability: kind == .channel ? discoverability : nil, createdByUserId: "user_ada",
          createdAt: created, updatedAt: created, unreadCount: 0, unreadMentionCount: 0, markedUnread: false,
          myAccess: .member,
          userMembers: [
            .init(id: "user_reader", name: "Me", email: "me@example.com", image: nil, presence: .offline),
            .init(id: "user_ada", name: "Ada Lovelace", email: "ada@example.com", image: nil, presence: .offline)
          ],
          coworkerMembers: [], sokoBotMembers: []
        )
      }

      private static func identity(_ room: Components.Schemas.ChatRoom) -> RoomHeaderIdentity {
        RoomHeaderIdentity(room: room, currentUserId: "user_reader")
      }

      /// The header as the app hosts it: the room pane's `NavigationStack` in a split view's detail column, in a
      /// window whose subtitle and toolbar SwiftUI drives. The pane paints the window background. A hand-built
      /// window never takes `navigationTitle` (only a scene's does), so it is given the room's name directly, as
      /// `ThreadMuteToggleTests` does; `RoomHeaderIdentityTests` proves the name.
      private static func window(_ identity: RoomHeaderIdentity, dark: Bool, width: CGFloat = 640) async throws -> NSWindow {
        let root = NavigationSplitView {
          List { Text("Channels") }
        } detail: {
          NavigationStack {
            Color(nsColor: .windowBackgroundColor)
              .frame(maxWidth: .infinity, maxHeight: .infinity)
              .modifier(RoomHeaderModifier(identity: identity))
          }
        }
        let controller = NSHostingController(rootView: root)
        controller.sceneBridgingOptions = .all
        let window = NSWindow(contentViewController: controller)
        window.title = identity.title
        window.styleMask.insert(.fullSizeContentView)
        window.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        window.setContentSize(NSSize(width: width, height: 140))
        window.orderFront(nil)
        let frame = try #require(window.contentView?.superview)
        // The mark is the header's one item of its own; a header without one gets the same few seconds to show it.
        let clock = ContinuousClock()
        let deadline = clock.now.advanced(by: .seconds(3))
        while headerItems(in: window).isEmpty, clock.now < deadline {
          frame.layoutSubtreeIfNeeded()
          try await Task.sleep(for: .milliseconds(20))
        }
        try await Task.sleep(for: .milliseconds(300))
        frame.layoutSubtreeIfNeeded()
        return window
      }

      /// The title bar's items other than the split view's own sidebar toggle, separator and spaces.
      private static func headerItems(in window: NSWindow) -> [NSToolbarItem] {
        let system: Set<NSToolbarItem.Identifier> = [.toggleSidebar, .sidebarTrackingSeparator, .flexibleSpace, .space]
        return (window.toolbar?.items ?? []).filter { !system.contains($0.itemIdentifier) }
      }

      /// SwiftUI builds no accessibility tree for a window no assistive client has asked about, so the mark's
      /// spoken name is not read here; `RoomHeaderIdentityTests` proves `channelDescription`.
      @Test(arguments: [
        (Components.Schemas.ChatRoom.DiscoverabilityPayload._public, "number"),
        (._private, "lock"),
        (.external, "globe"),
        (.matched, "globe")
      ])
      func aChannelsTitleBarShowsItsGlyphAndTopic(example: (Components.Schemas.ChatRoom.DiscoverabilityPayload, String)) async throws {
        let room = Self.room("launch", topic: "  Weekly launch\nplanning  ", discoverability: example.0)
        let identity = Self.identity(room)
        let window = try await Self.window(identity, dark: false)
        defer { window.orderOut(nil) }
        #expect(window.subtitle == "Weekly launch planning")
        let items = Self.headerItems(in: window).map(\.itemIdentifier.rawValue)
        #expect(items.count == 1, "The glyph is the Channel's one title bar item: \(items)")
        #expect(identity.mark == .channel(ChannelMark(example.0)))
        #expect(ChannelMark(example.0).systemImage == example.1)
      }

      @Test func aChannelWithoutATopicShowsItsGlyphAndNoSubtitle() async throws {
        let window = try await Self.window(Self.identity(Self.room("general", topic: " \n ")), dark: false)
        defer { window.orderOut(nil) }
        #expect(window.subtitle.isEmpty)
        let items = Self.headerItems(in: window).map(\.itemIdentifier.rawValue)
        #expect(items.count == 1, "The glyph is the Channel's one title bar item: \(items)")
      }

      @Test func aDirectShowsTheMessageGlyphAndNoTopic() async throws {
        let window = try await Self.window(Self.identity(Self.room("dm", topic: "Ignored", kind: .direct)), dark: false)
        defer { window.orderOut(nil) }
        let items = Self.headerItems(in: window).map(\.itemIdentifier.rawValue)
        #expect(items.count == 1, "The message glyph is the Direct's one title bar item: \(items)")
        #expect(window.subtitle.isEmpty)
      }

      /// The recorded picture: each header's title bar band, light beside dark.
      @Test func rendersTheHeaderInLightAndDark() async throws {
        let long = "Weekly launch planning, release notes, the go/no-go call and everything the support rota needs to know"
        let rooms = [
          (Self.room("general", topic: "Company-wide announcements", discoverability: ._public), 640.0),
          (Self.room("leadership", topic: "Owners and admins", discoverability: ._private), 640),
          (Self.room("acme-partners", topic: "Shared with Acme Corp", discoverability: .external), 640),
          (Self.room("matched-builders", topic: "Matched across organizations", discoverability: .matched), 640),
          (Self.room("launch", topic: long, discoverability: ._public), 520),
          (Self.room("no-topic", discoverability: ._public), 640),
          (Self.room("dm", kind: .direct), 640)
        ]
        var columns: [[CGImage]] = [[], []]
        for (column, dark) in [false, true].enumerated() {
          for (room, width) in rooms {
            let window = try await Self.window(Self.identity(room), dark: dark, width: width)
            let frame = try #require(window.contentView?.superview)
            let bitmap = try #require(frame.bitmapImageRepForCachingDisplay(in: frame.bounds))
            frame.cacheDisplay(in: frame.bounds, to: bitmap)
            window.orderOut(nil)
            let image = try #require(bitmap.cgImage)
            let scale = CGFloat(image.width) / frame.bounds.width
            try columns[column].append(#require(image.cropping(to: CGRect(
              x: 0, y: 0, width: CGFloat(image.width), height: (Self.titleBarHeight * scale).rounded()
            ))))
          }
        }
        let combined = try Self.stitched(columns)
        try Attachment.record(#require(combined.representation(using: .png, properties: [:])), named: "room-header-identity.png")
        // Nothing renders transparent: the title bar is painted in both appearances.
        for images in columns {
          for image in images {
            let rep = NSBitmapImageRep(cgImage: image)
            let pixel = try #require(rep.colorAt(x: rep.pixelsWide - 20, y: rep.pixelsHigh / 2))
            #expect(pixel.alphaComponent == 1, "Title bar alpha: \(pixel.alphaComponent)")
          }
        }
      }

      /// The columns side by side, top-aligned, 8 px apart over grey.
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
#endif

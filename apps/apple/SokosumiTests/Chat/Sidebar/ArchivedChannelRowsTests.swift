#if os(macOS)
  import AppKit
  import CoreAPI
  import HTTPTypes
  import OpenAPIRuntime
  @testable import Sokosumi
  import SokosumiChat
  import SwiftUI
  import Testing

  extension NativeWindowTests {
    /// Row 32b2: with the caller's role unreadable, web's Archived section still lists its channels and each row offers
    /// Restore alone (`organization-chat-list.client.tsx`, `canDeleteArchivedRooms` false). The rows load through the
    /// real `archivedChannels` and draw as the sidebar's Archived section draws them.
    @MainActor struct ArchivedChannelRowsTests {
      private static let names = ["design-reviews", "quarterly-roadmap-planning-and-the-very-long-launch-review"]

      private func loaded(role: ArchivedFixtureTransport.Role) async throws -> ArchivedChannels {
        let model = ArchivedChannels()
        let client = try Client.connecting(to: #require(URL(string: "https://example.com")), transport: ArchivedFixtureTransport(role: role, names: Self.names))
        await model.load { try await ChatService().archivedChannels(client: client, organizationId: "org", organizationSlug: "team") }
        return model
      }

      /// The section as `ConversationSidebarView` lists it, in a sidebar List over the window background.
      private func mount(_ model: ArchivedChannels, dark: Bool) -> (NSHostingView<some View>, NSWindow) {
        let size = NSRect(x: 0, y: 0, width: 260, height: 140)
        let content = List {
          Section("Archived") {
            ForEach(model.rooms, id: \.id) { room in
              ArchivedChannelRow(room: room, pending: false, busy: false, canDelete: model.canDelete) { _ in }
            }
          }
        }
        .listStyle(.sidebar)
        .frame(width: size.width, height: size.height)
        .background(.background)
        .environment(\.colorScheme, dark ? .dark : .light)
        let host = NSHostingView(rootView: content)
        let window = NSWindow(contentRect: size, styleMask: [.titled], backing: .buffered, defer: false)
        window.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        window.contentView = host
        window.makeKeyAndOrderFront(nil)
        return (host, window)
      }

      /// The titles of the menu a right-click on the first archived row opens.
      private func rowMenu(in host: NSView, window: NSWindow) async throws -> [String] {
        let table = try await waitForView(in: host, timeoutMessage: "The archived rows never mounted") {
          Self.views(NSTableView.self, in: host).first { $0.numberOfRows > Self.names.count }
        }
        // Row 0 is the section header.
        let row = table.rect(ofRow: 1)
        let recorder = MenuRecorder()
        defer { recorder.stop() }
        for type in [NSEvent.EventType.rightMouseDown, .rightMouseUp] {
          let event = try #require(NSEvent.mouseEvent(
            with: type, location: table.convert(NSPoint(x: row.midX, y: row.midY), to: nil), modifierFlags: [],
            timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window.windowNumber, context: nil,
            eventNumber: 0, clickCount: 1, pressure: type == .rightMouseDown ? 1 : 0
          ))
          NSApp.postEvent(event, atStart: false)
        }
        return try await recorder.menu(after: 0)?.items.filter { !$0.isSeparatorItem }.map(\.title) ?? []
      }

      private static func views<V: NSView>(_ type: V.Type, in view: NSView) -> [V] {
        ((view as? V).map { [$0] } ?? []) + view.subviews.flatMap { views(type, in: $0) }
      }

      /// A 500 on the role read: both channels list, name-sorted and truncated, and the menu holds Restore alone.
      /// Recorded light beside dark.
      @Test func aFailedRoleReadListsTheRowsWithRestoreOnly() async throws {
        var columns: [[CGImage]] = []
        for dark in [false, true] {
          let model = try await loaded(role: .failed)
          #expect(model.rooms.map(\.name) == Self.names && !model.canDelete)
          let (host, window) = mount(model, dark: dark)
          defer { window.orderOut(nil) }
          #expect(try await rowMenu(in: host, window: window) == ["Restore"])
          host.layoutSubtreeIfNeeded()
          let bitmap = try #require(host.bitmapImageRepForCachingDisplay(in: host.bounds))
          host.cacheDisplay(in: host.bounds, to: bitmap)
          try CreateChannelGuidanceTests.expectWindowBackground(bitmap, dark: dark)
          if let lines = try CreateChannelGuidanceTests.recognizedLines(in: bitmap) {
            let text = lines.joined(separator: "\n")
            #expect(["Archived", "design-reviews", "quarterly-roadmap"].allSatisfy(text.contains), "Vision read \(lines)")
          }
          try columns.append([#require(bitmap.cgImage)])
        }
        let combined = try RoomHeaderTests.stitched(columns)
        try Attachment.record(#require(combined.representation(using: .png, properties: [:])), named: "archived-role-failed.png")
      }

      /// The control: with the role read, the same row's menu also offers Delete.
      @Test func anOwnerSeesDeleteInTheRowMenu() async throws {
        let model = try await loaded(role: .owner)
        #expect(model.rooms.map(\.name) == Self.names && model.canDelete)
        let (host, window) = mount(model, dark: false)
        defer { window.orderOut(nil) }
        #expect(try await rowMenu(in: host, window: window) == ["Restore", "Delete…"])
      }
    }
  }

  /// The caller's membership (an owner, or a 500) and a page of archived channels.
  private nonisolated struct ArchivedFixtureTransport: ClientTransport {
    enum Role { case owner, failed }

    let role: Role
    let names: [String]

    private static let timestamp = "2026-10-01T09:00:00.000Z"

    func send(_: HTTPRequest, body _: HTTPBody?, baseURL _: URL, operationID: String) async throws -> (HTTPResponse, HTTPBody?) {
      let meta = #""meta":{"timestamp":"\#(Self.timestamp)","requestId":"fixture""#
      switch operationID {
      case "get/users/{id}/organizations/{organizationId}/member" where role == .owner:
        return (HTTPResponse(status: .ok), HTTPBody(#"{"data":{"id":"member-me","userId":"me","organizationId":"org","role":"owner","seatAssignedAt":null,"createdAt":"\#(Self.timestamp)"},\#(meta)}}"#))
      case "get/users/{id}/organizations/{organizationId}/member":
        return (HTTPResponse(status: .internalServerError), HTTPBody(#"{"error":"Internal Server Error","message":"Unavailable",\#(meta),"path":"/users/me/organizations/org/member","method":"GET"}}"#))
      case "get/chats/rooms":
        let rooms = names.enumerated().map { index, name in
          #"{"id":"550e8400-e29b-41d4-a716-44665544010\#(index)","organizationId":"org","organizationName":"Acme","name":"\#(name)","slug":"\#(name)","kind":"channel","isSelfDirect":false,"directKey":null,"isGroupDirect":false,"groupName":null,"topic":null,"discoverability":"\#(index == 0 ? "public" : "private")","createdByUserId":"me","createdAt":"\#(Self.timestamp)","updatedAt":"\#(Self.timestamp)","unreadCount":0,"unreadMentionCount":0,"starredAt":null,"pinnedMessageCount":0,"mutedAt":null,"markedUnread":false,"myAccess":"member","peerInActiveOrganization":false,"userMembers":[],"coworkerMembers":[],"sokoBotMembers":[]}"#
        }
        return (HTTPResponse(status: .ok), HTTPBody(#"{"data":[\#(rooms.joined(separator: ","))],\#(meta),"pagination":{"cursor":null,"limit":100,"total":\#(rooms.count),"nextCursor":null}}}"#))
      default:
        Issue.record("Unexpected request \(operationID)")
        return (HTTPResponse(status: .notFound), HTTPBody("{}"))
      }
    }
  }
#endif

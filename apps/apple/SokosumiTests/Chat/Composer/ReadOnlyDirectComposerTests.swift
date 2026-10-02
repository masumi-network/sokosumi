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
    /// Web `ReadOnlyDirectNotice`: in a Read-only Direct the room and Thread composers give way to the notice, so
    /// nothing in either pane can be typed into; a Direct someone is still in keeps its composer.
    @MainActor struct ReadOnlyDirectComposerTests {
      private static func room(readOnly: Bool) -> Components.Schemas.ChatRoom {
        .init(
          id: "fixture", name: "Direct", kind: .direct, isSelfDirect: false, isGroupDirect: false, isReadOnly: readOnly,
          createdByUserId: "", createdAt: .distantPast, updatedAt: .distantPast, unreadCount: 0, unreadMentionCount: 0,
          markedUnread: false, myAccess: .init(value1: .member, value2: "member"),
          userMembers: readOnly ? [] : [.init(id: "sarthi", name: "Sarthi", email: "sarthi@example.com", presence: .offline)],
          formerUserMembers: readOnly ? [.init(id: "sarthi", name: "Sarthi", email: "sarthi@example.com", image: nil)] : [],
          coworkerMembers: [], sokoBotMembers: []
        )
      }

      private static func editableTextViews(_ view: NSView) -> [NSTextView] {
        ((view as? NSTextView).flatMap { $0.isEditable ? [$0] : nil } ?? []) + view.subviews.flatMap(editableTextViews)
      }

      private static func host(thread: Bool, readOnly: Bool, state: WorkspaceState? = nil) async throws -> (NSHostingView<AnyView>, NSWindow) {
        let state = try state ?? TranscriptScrollingTests.fixtureState(thread: thread, media: false)
        state.rooms = [room(readOnly: readOnly)]
        let host = NSHostingView(rootView: AnyView(Group {
          if thread {
            ReplyThreadView()
          } else {
            RoomTimelineView(roomId: "fixture")
          }
        }.background(.background).environment(\.locale, Locale(identifier: "en")).environmentObject(state).environmentObject(AuthState())))
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 700, height: 420), styleMask: [.titled], backing: .buffered, defer: false)
        window.appearance = NSAppearance(named: .aqua)
        window.ignoresMouseEvents = true
        window.contentView = host
        window.orderFront(nil)
        _ = try await loadedTranscriptScrollView(in: host)
        return (host, window)
      }

      @Test(arguments: [false, true])
      func theNoticeReplacesTheComposer(thread: Bool) async throws {
        let (host, window) = try await Self.host(thread: thread, readOnly: true)
        defer { window.orderOut(nil) }
        #expect(Self.editableTextViews(host).isEmpty, "A Read-only Direct offers nothing to type into")
        let bitmap = try #require(host.bitmapImageRepForCachingDisplay(in: host.bounds))
        host.cacheDisplay(in: host.bounds, to: bitmap)
        try Attachment.record(#require(bitmap.representation(using: .png, properties: [:])), named: "read-only-direct-\(thread ? "thread" : "room").png")
        // Vision reads text only on a local run (the CI runner returns nil).
        guard let lines = try RoomThreadOverviewGroupsViewTests.recognizedText(in: bitmap) else { return }
        #expect(lines.contains { $0.text.hasPrefix("Sarthi left.") }, "The notice names who left: \(lines.map(\.text))")
      }

      @Test(arguments: [false, true])
      func aDirectSomeoneIsStillInKeepsItsComposer(thread: Bool) async throws {
        let (host, window) = try await Self.host(thread: thread, readOnly: false)
        defer { window.orderOut(nil) }
        _ = try await waitForView(in: host, timeoutMessage: "The composer never mounted") { Self.editableTextViews(host).first }
      }

      private static func reactionMenus(_ view: NSView) -> [MessageContextMenuView] {
        (view as? MessageContextMenuView).map { [$0] } ?? view.subviews.flatMap(reactionMenus)
      }

      @Test(arguments: [false, true])
      func becomingReadOnlyDismissesAnOpenReactionPicker(thread: Bool) async throws {
        let state = try TranscriptScrollingTests.fixtureState(thread: thread, media: false)
        let (host, window) = try await Self.host(thread: thread, readOnly: false, state: state)
        defer { window.orderOut(nil) }
        window.center()
        window.makeKeyAndOrderFront(nil)
        let menu = try await waitForView(in: host, timeoutMessage: "A message with reactions never mounted") {
          Self.reactionMenus(host).last { $0.availability.canReact && !$0.visibleRect.isEmpty }
        }
        let before = Set(NSApp.windows.map(ObjectIdentifier.init))
        // Invoke the real row action through the existing native context-menu adapter.
        menu.perform(.addReaction)
        let picker = try await waitForView(in: host, timeoutMessage: "The reaction picker never opened") {
          NSApp.windows.first {
            !before.contains(ObjectIdentifier($0)) && $0.isVisible && String(describing: type(of: $0)).contains("Popover")
          }?.contentView
        }
        let pickerWindow = try #require(picker.window)
        defer { pickerWindow.orderOut(nil) }

        state.rooms = [Self.room(readOnly: true)]
        _ = try await waitForView(in: host, timeoutMessage: "Reaction access did not close") {
          Self.reactionMenus(host).first { !$0.availability.canReact && $0.availability.canCopyLink }
        }
        // Allow the popover's dismissal animation to settle after the room refresh.
        try await Task.sleep(for: .milliseconds(500))
        #expect(!pickerWindow.isVisible, "An open reaction picker must close when the room becomes read-only")
      }
    }
  }
#endif

#if os(macOS)
  import AppKit
  import CoreAPI
  @testable import Sokosumi
  import SokosumiAuth
  import SokosumiChat
  import SokosumiWorkspace
  import SwiftUI
  import Testing

  /// One room composer (or, with `parentMessageId`, a Thread composer) hosted in a window over the
  /// window background, with the room's Typing state driven directly.
  @MainActor private final class RoomTypingFixture {
    static let roomId = "typing-room"
    static let origin = Date(timeIntervalSince1970: 1_800_000_000)
    static let members: [(id: String, name: String)] = [
      ("pat", "Patrick Tobin"), ("kim", "Kim Ferrari"), ("andreas", "Andreas Osberghaus"),
      ("long-a", "Maximiliane Alexandra von Hohenstaufen-Wittelsbach"), ("long-b", "Bartholomäus Konstantin Freiherr zu Guttenberg")
    ]

    let state: WorkspaceState
    let activity: FixtureWindowActivity
    let host: NSHostingView<AnyView>
    let window: NSWindow
    private let saved: SavedComposeDraft

    init(typists: [String] = [], width: CGFloat = 520, dark: Bool = false, parentMessageId: String? = nil, draft: String = "") throws {
      let userId = UUID().uuidString
      let state = WorkspaceState()
      let activity = FixtureWindowActivity()
      self.state = state
      self.activity = activity
      saved = SavedComposeDraft(userId: userId, organizationId: nil, roomId: Self.roomId, parentMessageId: parentMessageId)
      saved.save(draft)
      state.rooms = [Self.room()]
      state.timeline.reset(roomId: Self.roomId)
      state.timeline.failInitialLoad(message: "Fixture has no server", generation: state.timeline.generation)
      state.typing.open(roomId: Self.roomId, selfUserId: "me")
      state.typing.channelChanged(roomId: Self.roomId, canPublish: true)
      let uploads = ComposeUploads(savedDraft: saved)
      host = NSHostingView(rootView: AnyView(FixtureActivityHost(activity: activity) {
        ChatComposerView(userId: userId, organizationId: nil, roomId: Self.roomId, parentMessageId: parentMessageId)
          .environmentObject(state).environmentObject(AuthState())
          .environmentObject(uploads).environmentObject(ComposerAttachmentIngress())
          .frame(width: width)
          .background(Color(nsColor: .windowBackgroundColor))
          .environment(\.colorScheme, dark ? .dark : .light)
      }))
      window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: width, height: 200), styleMask: [.titled], backing: .buffered, defer: false)
      window.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
      window.contentView = host
      window.orderFront(nil)
      type(typists)
    }

    func close() {
      saved.save("")
      window.orderOut(nil)
    }

    /// Each of `typists` starts typing, a second apart.
    func type(_ typists: [String]) {
      for (offset, id) in typists.enumerated() {
        state.typing.apply(.init(userId: id, state: .started), roomId: Self.roomId, now: Self.origin.addingTimeInterval(Double(offset)))
      }
    }

    func input() async throws -> MacComposerTextInput.InputView {
      try await waitForView(in: host, timeoutMessage: "The composer did not mount") { Self.input(in: host) }
    }

    /// The composer drawn at its fitting size, once the last state change has been laid out.
    func bitmap() async throws -> NSBitmapImageRep {
      _ = try await input()
      for _ in 0 ..< 3 {
        await Task.yield()
        host.layoutSubtreeIfNeeded()
      }
      return try fittedBitmap(of: host, in: window)
    }

    private static func input(in view: NSView) -> MacComposerTextInput.InputView? {
      (view as? MacComposerTextInput.InputView) ?? view.subviews.lazy.compactMap { input(in: $0) }.first
    }

    private static func room() -> Components.Schemas.ChatRoom {
      .init(
        id: roomId, organizationId: "org", name: "Team", slug: "team", kind: .channel, isSelfDirect: false, isGroupDirect: false, isReadOnly: false, topic: nil,
        discoverability: ._private, createdByUserId: "me", createdAt: .distantPast, updatedAt: .distantPast,
        unreadCount: 0, unreadMentionCount: 0, markedUnread: false, myAccess: .init(value1: .member, value2: "member"),
        userMembers: members.map { .init(id: $0.id, name: $0.name, email: "\($0.id)@example.com", presence: .online) },
        formerUserMembers: [], coworkerMembers: [], sokoBotMembers: []
      )
    }
  }

  /// Whether the fixture's window reads as active; a hosted test window is never the key window.
  @MainActor private final class FixtureWindowActivity: ObservableObject {
    @Published var appearsActive = true
  }

  private struct FixtureActivityHost<Content: View>: View {
    @ObservedObject var activity: FixtureWindowActivity
    @ViewBuilder let content: Content

    var body: some View {
      content.environment(\.appearsActive, activity.appearsActive)
    }
  }

  /// One rendered state of the line, and the text Vision should read in it.
  private struct TypingPanel {
    let name: String
    let typists: [String]
    var width: CGFloat = 520
    let text: String?

    static let all = [
      TypingPanel(name: "quiet", typists: [], text: nil),
      TypingPanel(name: "one", typists: ["pat"], text: "Patrick Tobin is typing"),
      TypingPanel(name: "two", typists: ["pat", "kim"], text: "Patrick Tobin and Kim Ferrari are typing"),
      TypingPanel(name: "several", typists: ["pat", "kim", "andreas"], text: "Several people are typing"),
      TypingPanel(name: "truncated", typists: ["long-a", "long-b"], width: 400, text: "Maximiliane Alexandra von Hohenstaufen-Wittelsbach and")
    ]
  }

  /// Rows of `bitmap` (origin top left) holding a pixel that differs from the same pixel of `other`.
  @MainActor private func changedRows(_ bitmap: NSBitmapImageRep, from other: NSBitmapImageRep) -> [Int] {
    (0 ..< min(bitmap.pixelsHigh, other.pixelsHigh)).filter { row in
      (0 ..< min(bitmap.pixelsWide, other.pixelsWide)).contains { column in
        guard let new = bitmap.colorAt(x: column, y: row)?.usingColorSpace(.deviceRGB),
              let old = other.colorAt(x: column, y: row)?.usingColorSpace(.deviceRGB) else { return false }
        return abs(new.redComponent - old.redComponent) + abs(new.greenComponent - old.greenComponent) + abs(new.blueComponent - old.blueComponent) > 0.12
      }
    }
  }

  extension NativeWindowTests {
    /// Row 36a: the Typing line under the room composer (web `RoomTypingLine`) and what makes the
    /// composer announce (web `RoomSessionComposer`'s `handleComposerValueChange`, blur and send).
    @MainActor struct RoomTypingLineTests {
      /// The line holds its height whether or not anyone is typing, so the composer never moves,
      /// and draws under the composer card, on one line however long the names are.
      @Test(arguments: zip([["pat"], ["long-a", "long-b"], ["pat", "kim", "andreas"]], [CGFloat(520), 400, 520]))
      func theLineDrawsUnderTheComposerWithoutMovingIt(typists: [String], width: CGFloat) async throws {
        let fixture = try RoomTypingFixture(width: width)
        defer { fixture.close() }
        let input = try await fixture.input()
        let quiet = try await fixture.bitmap()
        let quietSize = fixture.host.fittingSize
        let field = try #require(input.enclosingScrollView)
        let fieldFrame = field.convert(field.bounds, to: nil)

        fixture.type(typists)
        let typing = try await fixture.bitmap()
        #expect(fixture.host.fittingSize == quietSize, "The composer keeps its size when somebody starts typing.")
        #expect(field.convert(field.bounds, to: nil) == fieldFrame, "The text field does not move.")
        let rows = changedRows(typing, from: quiet)
        let scale = CGFloat(typing.pixelsHigh) / quietSize.height
        // The card ends one 20 pt inset above the pane's bottom edge; the line stands in that inset.
        let first = try #require(rows.first, "The line draws who is typing.")
        let last = try #require(rows.last)
        #expect(CGFloat(first) / scale > quietSize.height - 20, "The line sits under the composer card, not in it.")
        #expect(CGFloat(last - first) / scale < 16, "The line is a single line of caption text.")
        #expect(CGFloat(last) / scale < quietSize.height - 3, "The line keeps clear of the window's bottom edge.")
      }

      /// One inset from the pane's left, right and bottom edges to the card's border (web `px-5`).
      @Test func theCardSitsOneInsetFromEachEdge() async throws {
        let fixture = try RoomTypingFixture()
        defer { fixture.close() }
        let bitmap = try await fixture.bitmap()
        let scale = CGFloat(bitmap.pixelsHigh) / fixture.host.fittingSize.height
        let background = try #require(bitmap.colorAt(x: 1, y: bitmap.pixelsHigh - 2)?.usingColorSpace(.deviceRGB))
        func ink(_ col: Int, _ row: Int) -> Bool {
          guard let color = bitmap.colorAt(x: col, y: row)?.usingColorSpace(.deviceRGB) else { return false }
          return abs(color.redComponent - background.redComponent) + abs(color.greenComponent - background.greenComponent)
            + abs(color.blueComponent - background.blueComponent) > 0.05
        }
        let middleRow = bitmap.pixelsHigh / 2, middleColumn = bitmap.pixelsWide / 2
        let left = try #require((0 ..< bitmap.pixelsWide).first { ink($0, middleRow) })
        let right = try #require((0 ..< bitmap.pixelsWide).reversed().first { ink($0, middleRow) })
        let bottom = try #require((0 ..< bitmap.pixelsHigh).reversed().first { ink(middleColumn, $0) })
        // The border's stroke straddles the card's edge, so its ink starts half a point outside it.
        let insets = [left, bitmap.pixelsWide - 1 - right, bitmap.pixelsHigh - 1 - bottom].map { CGFloat($0) / scale }
        #expect(insets.allSatisfy { abs($0 - 19.5) <= 1 }, "Left, right and bottom insets: \(insets).")
      }

      @Test(arguments: [false, true])
      func rendersTheTypingLine(dark: Bool) async throws {
        for panel in TypingPanel.all {
          let fixture = try RoomTypingFixture(typists: panel.typists, width: panel.width, dark: dark, draft: panel.name == "two" ? "Almost done with the draft" : "")
          defer { fixture.close() }
          let bitmap = try await fixture.bitmap()
          try Attachment.record(#require(bitmap.representation(using: .png, properties: [:])), named: "typing-\(panel.name)-\(dark ? "dark" : "light").png")
          let background = try #require(bitmap.colorAt(x: 1, y: bitmap.pixelsHigh - 2)?.usingColorSpace(.deviceRGB))
          #expect(background.alphaComponent == 1, "Nothing renders transparent.")
          #expect(dark ? background.brightnessComponent < 0.5 : background.brightnessComponent > 0.5)
          guard let lines = try RoomThreadOverviewGroupsViewTests.recognizedText(in: bitmap) else { continue }
          if let text = panel.text {
            #expect(lines.count { $0.text.contains(text) } == 1, "\(panel.name): read \(lines.map(\.text)).")
          } else {
            #expect(!lines.contains { $0.text.contains("typing") }, "A quiet room names nobody: \(lines.map(\.text)).")
          }
          // Two long names end in an ellipsis on the one line instead of wrapping or running on.
          if panel.name == "truncated" {
            #expect(!lines.contains { $0.text.contains("Guttenberg are typing") }, "The line truncates: \(lines.map(\.text)).")
          }
        }
      }

      /// Web's `handleComposerValueChange`: a genuine edit announces; the Thread composer, which
      /// web mounts outside `RoomTypingProvider`, says nothing.
      @Test(arguments: [nil, "parent-message"])
      func onlyTheRoomComposerAnnouncesAnEdit(parent: String?) async throws {
        let fixture = try RoomTypingFixture(parentMessageId: parent)
        defer { fixture.close() }
        let input = try await fixture.input()
        input.insertText("h", replacementRange: input.selectedRange())
        #expect(fixture.state.typing.isAnnounced == (parent == nil))
      }

      @Test func clearingTheDraftAndLosingFocusStop() async throws {
        let fixture = try RoomTypingFixture()
        defer { fixture.close() }
        let input = try await fixture.input()
        input.insertText("hello", replacementRange: input.selectedRange())
        #expect(fixture.state.typing.isAnnounced)
        input.selectAll(nil)
        input.deleteBackward(nil)
        #expect(!fixture.state.typing.isAnnounced, "Clearing the composer back to empty stops.")

        input.insertText("again", replacementRange: input.selectedRange())
        #expect(fixture.state.typing.isAnnounced)
        fixture.window.makeFirstResponder(input)
        fixture.window.makeFirstResponder(nil)
        for _ in 0 ..< 1000 where fixture.state.typing.isAnnounced {
          await Task.yield()
        }
        #expect(!fixture.state.typing.isAnnounced, "Blur stops.")
      }

      /// Text the person did not type never announces: a draft restored on open, the link the
      /// link editor saves, and a pasted Message link put back when its quote is removed.
      @Test func aRestoredDraftAndAppInsertedTextStaySilent() async throws {
        let fixture = try RoomTypingFixture(draft: "abandoned draft")
        defer { fixture.close() }
        let mounted = try await fixture.input()
        let input = try await waitForView(in: fixture.host, timeoutMessage: "The draft did not load") {
          mounted.serializedDraft == "abandoned draft" ? mounted : nil
        }
        #expect(!fixture.state.typing.isAnnounced, "Opening a room with an abandoned draft stays silent.")
        input.insertAtCaret(" https://app.sokosumi.com/chat/typing-room?message=1")
        #expect(input.string.hasSuffix("message=1"))
        #expect(!fixture.state.typing.isAnnounced, "A restored Message link is not typing.")
        input.insertLink(label: "Ably", destination: "https://ably.com", range: NSRange(location: input.string.utf16.count, length: 0))
        #expect(input.string.hasSuffix("Ably"))
        #expect(!fixture.state.typing.isAnnounced, "A link the editor inserted is not typing.")
        // The next keystroke is the person's own again.
        input.insertText("!", replacementRange: input.selectedRange())
        #expect(fixture.state.typing.isAnnounced)
      }

      /// Web's editor blurs with the browser window; a Mac text view keeps first responder, so
      /// the composer stops when its window stops being active.
      @Test func anInactiveWindowStops() async throws {
        let fixture = try RoomTypingFixture()
        defer { fixture.close() }
        let input = try await fixture.input()
        input.insertText("hello", replacementRange: input.selectedRange())
        #expect(fixture.state.typing.isAnnounced)
        fixture.activity.appearsActive = false
        for _ in 0 ..< 1000 where fixture.state.typing.isAnnounced {
          await Task.yield()
        }
        #expect(!fixture.state.typing.isAnnounced)
      }
    }
  }
#endif

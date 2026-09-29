#if os(macOS)
  import AppKit
  import CoreAPI
  @testable import Sokosumi
  import SokosumiAuth
  import SokosumiChat
  import SokosumiWorkspace
  import SwiftUI
  import Testing

  /// Records every menu AppKit starts tracking, then closes it, so a posted right-click never blocks the run.
  @MainActor private final class MenuRecorder {
    private(set) var menus: [NSMenu] = []
    private var observer: NSObjectProtocol?

    init() {
      observer = NotificationCenter.default.addObserver(forName: NSMenu.didBeginTrackingNotification, object: nil, queue: nil) { [weak self] note in
        nonisolated(unsafe) let object = note.object
        MainActor.assumeIsolated {
          guard let menu = object as? NSMenu else { return }
          self?.menus.append(menu)
          nonisolated(unsafe) let tracked = menu
          RunLoop.main.perform(inModes: [.common, .eventTracking]) {
            tracked.cancelTrackingWithoutAnimation()
          }
        }
      }
    }

    func stop() {
      observer.map(NotificationCenter.default.removeObserver)
      observer = nil
    }

    /// The next menu opened after `count` menus, within two seconds.
    func menu(after count: Int) async throws -> NSMenu? {
      let deadline = ContinuousClock.now.advanced(by: .seconds(2))
      while menus.count <= count, ContinuousClock.now < deadline {
        try await Task.sleep(for: .milliseconds(20))
      }
      return menus.count > count ? menus[count] : nil
    }
  }

  /// "Title[action]" per item and "|" per separator.
  @MainActor private func outline(_ menu: NSMenu?) -> [String] {
    menu?.items.map { item in
      item.isSeparatorItem ? "|" : "\(item.title)[\(item.action.map(NSStringFromSelector) ?? "-")]"
    } ?? []
  }

  @MainActor private final class Calls {
    var quotes = 0
  }

  /// Every item and type on a pasteboard, so a test can put back what the user had copied.
  @MainActor private struct PasteboardSnapshot {
    private let items: [[NSPasteboard.PasteboardType: Data]]

    init(_ pasteboard: NSPasteboard) {
      items = (pasteboard.pasteboardItems ?? []).map { item in
        Dictionary(uniqueKeysWithValues: item.types.compactMap { type in item.data(forType: type).map { (type, $0) } })
      }
    }

    func restore(to pasteboard: NSPasteboard) {
      pasteboard.clearContents()
      pasteboard.writeObjects(items.map { data in
        let item = NSPasteboardItem()
        for (type, value) in data {
          item.setData(value, forType: type)
        }
        return item
      })
    }
  }

  /// A message row in a window, and the text right-clicks aim at.
  @MainActor private struct MessageMenuFixture {
    let window: NSWindow
    let host: NSView
    let text: NSView
    let recorder: MenuRecorder
    let calls: Calls
    let editing: MessageEditing

    func close() {
      recorder.stop()
      editing.reset()
      window.orderOut(nil)
    }

    /// Posts a click at `point` in `view`'s coordinates through the app's event queue.
    func click(_ type: NSEvent.EventType, at point: NSPoint, in view: NSView, modifiers: NSEvent.ModifierFlags = []) throws {
      let release: NSEvent.EventType = type == .rightMouseDown ? .rightMouseUp : .leftMouseUp
      for eventType in [type, release] {
        let event = try #require(NSEvent.mouseEvent(
          with: eventType, location: view.convert(point, to: nil), modifierFlags: modifiers,
          timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window.windowNumber, context: nil,
          eventNumber: 0, clickCount: 1, pressure: eventType == release ? 0 : 1
        ))
        NSApp.postEvent(event, atStart: false)
      }
    }

    func rightClick(at point: NSPoint, in view: NSView, modifiers: NSEvent.ModifierFlags = []) async throws -> NSMenu? {
      let count = recorder.menus.count
      try click(modifiers.contains(.control) ? .leftMouseDown : .rightMouseDown, at: point, in: view, modifiers: modifiers)
      return try await recorder.menu(after: count)
    }

    var textCenter: NSPoint {
      NSPoint(x: text.bounds.midX, y: text.bounds.midY)
    }
  }

  extension NativeWindowTests {
    /// M7: a right-click anywhere on a message, its text included, opens the message's own menu. The body is
    /// selectable SwiftUI `Text`, which AppKit backs with a text view that otherwise answers with an editing menu.
    /// Events are posted to the app queue so `NSApp.currentEvent` is the click, as in the running app.
    @MainActor struct MessageContextMenuTests {
      private static let body = "Release notes for the whole team are in the shared folder now."
      private static let ownActions = [
        "Add reaction[performMenuAction:]", "Edit message[performMenuAction:]", "Quote message[performMenuAction:]",
        "Reply in thread[performMenuAction:]", "|",
        "Pin message[performMenuAction:]", "Copy link[performMenuAction:]", "Send to yourself[performMenuAction:]", "|",
        "Delete message[performMenuAction:]"
      ]
      /// What AppKit's text menu carries and read-only message text must not offer.
      private static let editingActions: Set = ["cut:", "paste:", "pasteAsPlainText:", "submenuAction:"]

      /// The viewer's own message in a channel, with every action its room row passes.
      private static func fixture(editingRow: Bool = false, content: String = body,
                                  quote: Components.Schemas.ChatRoomMessageQuote? = nil) async throws -> MessageMenuFixture {
        var message = chatRoomMessage(from: .init(clientTurnId: "turn", roomId: "room_1", content: content,
                                                  sender: .init(id: "user", name: "Ada", email: "ada@example.com", presence: .online)))
        message.id = "message_1"
        message.metadata = nil
        message.quote = quote
        let workspaces = WorkspaceState()
        let editing = workspaces.messageEditing
        if editingRow {
          editing.start(message, userId: "user")
        }
        let calls = Calls()
        let row = MessageRowView(message: message, isContinuation: false, outbound: nil, onRetry: nil, onRemove: nil,
                                 onReply: {}, onQuote: { calls.quotes += 1 }, onEdit: {},
                                 isPinned: false, onTogglePin: {}, onDelete: {},
                                 onToggleReaction: { _ in true }, editing: editing, onSendToSelf: { message })
        let hosted = row
          .padding(16)
          .frame(width: 520, alignment: .topLeading)
          .background(.background)
          .environmentObject(workspaces)
          .environmentObject(AuthState())
        let host = NSHostingView(rootView: hosted)
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 520, height: 220), styleMask: [.titled], backing: .buffered, defer: false)
        window.contentView = host
        window.makeKeyAndOrderFront(nil)
        let text = try await waitForView(in: host, timeoutMessage: "The row did not mount its text") {
          editingRow ? inputView(in: host) : selectableText(in: host)
        }
        return MessageMenuFixture(window: window, host: host, text: text, recorder: MenuRecorder(), calls: calls, editing: editing)
      }

      /// The first selectable text: AppKit's static text that copies its selection.
      private static func selectableText(in view: NSView) -> NSView? {
        selectableTexts(in: view).first
      }

      private static func selectableTexts(in view: NSView) -> [NSView] {
        if view.accessibilityRole() == .staticText, view.responds(to: #selector(NSText.copy(_:))), !(view is NSTextView) {
          return [view]
        }
        return view.subviews.flatMap(selectableTexts)
      }

      private static func inputView(in view: NSView) -> NSView? {
        if let input = view as? MacComposerTextInput.InputView {
          return input
        }
        return view.subviews.lazy.compactMap { inputView(in: $0) }.first
      }

      @Test func rightClickOnTheBodyTextOpensTheMessageMenu() async throws {
        let fixture = try await Self.fixture()
        defer { fixture.close() }
        let menu = try await fixture.rightClick(at: fixture.textCenter, in: fixture.text)
        #expect(outline(menu) == Self.ownActions)
        let actions = Set(menu?.items.compactMap { $0.action.map(NSStringFromSelector) } ?? [])
        #expect(actions.isDisjoint(with: Self.editingActions))
      }

      /// The quoted snippet and a code block are selectable text of their own inside the same row.
      @Test func rightClickOnQuotedTextAndCodeOpensTheMessageMenu() async throws {
        let quote = Components.Schemas.ChatRoomMessageQuote(messageId: "source", authorName: "Ben", snippet: "Ship the release on Friday.")
        let fixture = try await Self.fixture(content: "Agreed, see below.\n\n```swift\nlet release = \"Friday\"\n```", quote: quote)
        defer { fixture.close() }
        let texts = try await waitForView(in: fixture.host, timeoutMessage: "The quote, body and code block did not mount") {
          Self.selectableTexts(in: fixture.host).count >= 3 ? fixture.host : nil
        }
        let found = Self.selectableTexts(in: texts)
        #expect(found.count == 3, "Quote snippet, paragraph and code block: \(found)")
        for text in found {
          let menu = try await fixture.rightClick(at: NSPoint(x: min(20, text.bounds.midX), y: text.bounds.midY), in: text)
          #expect(outline(menu) == Self.ownActions, "\(String(describing: text.accessibilityValue()))")
        }
      }

      @Test func rightClickBesideTheTextOpensTheSameMenu() async throws {
        let fixture = try await Self.fixture()
        defer { fixture.close() }
        // Right of the sender name and time, above the body.
        let host = fixture.host
        let text = fixture.text.convert(fixture.text.bounds, to: host)
        let besideHeader = NSPoint(x: host.bounds.maxX - 40, y: host.isFlipped ? text.minY - 12 : text.maxY + 12)
        #expect(try await outline(fixture.rightClick(at: besideHeader, in: host)) == Self.ownActions)
      }

      @Test func controlClickOnTheTextOpensTheMessageMenu() async throws {
        let fixture = try await Self.fixture()
        defer { fixture.close() }
        #expect(try await outline(fixture.rightClick(at: fixture.textCenter, in: fixture.text, modifiers: .control)) == Self.ownActions)
      }

      @Test func aSelectionInTheMessageAddsCopyForIt() async throws {
        let fixture = try await Self.fixture()
        defer { fixture.close() }
        fixture.window.makeFirstResponder(fixture.text)
        // "notes for" in "Release notes for the whole team…".
        fixture.text.setAccessibilitySelectedTextRange(NSRange(location: 8, length: 9))
        try #require(fixture.text.accessibilitySelectedText() == "notes for", "The body selected a known substring.")
        let menu = try #require(try await fixture.rightClick(at: fixture.textCenter, in: fixture.text))
        #expect(outline(menu) == ["Copy[copy:]", "|"] + Self.ownActions)
        #expect(menu.items.first?.isEnabled == true)
        let saved = PasteboardSnapshot(NSPasteboard.general)
        defer { saved.restore(to: NSPasteboard.general) }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString("before", forType: .string)
        // What choosing the item does: send its action to its target.
        let copy = try #require(menu.items.first)
        let action = try #require(copy.action)
        let target = try #require(copy.target as? NSResponder, "Copy has a target.")
        try #require(target.responds(to: action), "Copy's target \(type(of: target)) handles \(NSStringFromSelector(action)).")
        #expect(NSApp.sendAction(action, to: target, from: copy))
        #expect(NSPasteboard.general.string(forType: .string) == "notes for", "Copy put the selection on the pasteboard.")
      }

      @Test func choosingAnItemRunsTheRowAction() async throws {
        let fixture = try await Self.fixture()
        defer { fixture.close() }
        let menu = try #require(try await fixture.rightClick(at: fixture.textCenter, in: fixture.text))
        let quote = try #require(menu.items.firstIndex { $0.title == "Quote message" })
        menu.performActionForItem(at: quote)
        #expect(fixture.calls.quotes == 1)
      }

      /// The hover pill sits half on the row above. A right-click there belongs to the row showing the pill: Edit,
      /// Quote and Reply must never act on the previous message.
      @Test func rightClickOnTheHoverPillOverTheRowAboveOpensItsOwnRow() async throws {
        let (first, second) = (Calls(), Calls())
        let fixture = try await Self.twoRows(first: first, second: second)
        defer { fixture.close() }
        let host = fixture.host
        // The rows' own areas span the row; the pills carry narrower ones.
        let frames = Self.menuAreas(in: host).map { $0.convert($0.bounds, to: host) }
          .filter { $0.width >= host.bounds.width - 32 }.sorted { $0.minY < $1.minY }
        try #require(host.isFlipped && frames.count == 2, "\(frames)")
        let (above, below) = (frames[0], frames[1])
        // The ⋯ button is the pill's last control: 3 pt padding, 28 pt wide, centred on the second row's top edge.
        let onPill = NSPoint(x: below.maxX - 3 - 14, y: below.minY - 8)
        try #require(above.contains(onPill), "\(onPill) lies on the first row \(above).")

        let before = try Self.pixels(around: onPill, in: host)
        try await Self.hover(NSPoint(x: below.midX, y: below.midY), in: fixture)
        try #require(try Self.pixels(around: onPill, in: host) != before, "The second row's pill is drawn over the first row.")
        let menu = try #require(try await fixture.rightClick(at: onPill, in: host))
        let quote = try #require(menu.items.firstIndex { $0.title == "Quote message" }, "\(outline(menu))")
        menu.performActionForItem(at: quote)
        #expect(second.quotes == 1, "The pill's row quotes.")
        #expect(first.quotes == 0, "The row above does not.")
      }

      /// Two of the viewer's messages, the second a continuation directly under the first, settled at their size.
      private static func twoRows(first: Calls, second: Calls) async throws -> MessageMenuFixture {
        func row(_ id: String, _ text: String, continuation: Bool, calls: Calls) -> MessageRowView {
          var message = chatRoomMessage(from: .init(clientTurnId: id, roomId: "room_1", content: text,
                                                    sender: .init(id: "user", name: "Ada", email: "ada@example.com", presence: .online)))
          message.id = id
          message.metadata = nil
          return MessageRowView(message: message, isContinuation: continuation, outbound: nil, onRetry: nil, onRemove: nil,
                                onReply: {}, onQuote: { calls.quotes += 1 }, onEdit: {}, onDelete: {},
                                onToggleReaction: { _ in true }, onSendToSelf: { message })
        }
        let workspaces = WorkspaceState()
        let hosted = VStack(alignment: .leading, spacing: 0) {
          row("first", "The first message, above.", continuation: false, calls: first)
          row("second", "The second message, whose pill overlaps the first.", continuation: true, calls: second)
        }
        .padding(16)
        .frame(width: 520, alignment: .topLeading)
        .background(.background)
        .environmentObject(workspaces)
        .environmentObject(AuthState())
        let host = NSHostingView(rootView: hosted)
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 520, height: 220), styleMask: [.titled], backing: .buffered, defer: false)
        window.contentView = host
        window.makeKeyAndOrderFront(nil)
        _ = try await waitForView(in: host, timeoutMessage: "Both rows did not mount their menu areas") {
          menuAreas(in: host).count(where: { $0.bounds.width >= 488 }) >= 2 ? host : nil
        }
        // Settle the window at the rows' size first; it otherwise shrinks to fit after the frames are read.
        window.setContentSize(host.fittingSize)
        for _ in 0 ..< 5 {
          host.layoutSubtreeIfNeeded()
          try await Task.sleep(for: .milliseconds(20))
        }
        return MessageMenuFixture(window: window, host: host, text: host, recorder: MenuRecorder(), calls: second,
                                  editing: workspaces.messageEditing)
      }

      /// The test host is never the active app, so AppKit delivers no tracking events: enter the hosting view's
      /// tracking areas and move to `point` by hand.
      private static func hover(_ point: NSPoint, in fixture: MessageMenuFixture) async throws {
        let location = fixture.host.convert(point, to: nil)
        func trackingAreas(_ view: NSView) -> [NSTrackingArea] {
          view.trackingAreas + view.subviews.flatMap(trackingAreas)
        }
        for area in trackingAreas(fixture.host) {
          let entered = try #require(NSEvent.enterExitEvent(
            with: .mouseEntered, location: location, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
            windowNumber: fixture.window.windowNumber, context: nil, eventNumber: 0,
            trackingNumber: Int(bitPattern: Unmanaged.passUnretained(area).toOpaque()), userData: nil
          ))
          (area.owner as? NSResponder)?.mouseEntered(with: entered)
        }
        let moved = try #require(NSEvent.mouseEvent(
          with: .mouseMoved, location: location, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
          windowNumber: fixture.window.windowNumber, context: nil, eventNumber: 0, clickCount: 0, pressure: 0
        ))
        fixture.host.mouseMoved(with: moved)
        try await Task.sleep(for: .milliseconds(300))
      }

      /// The drawn pixels of a small square around `point`, to tell whether something now covers it.
      private static func pixels(around point: NSPoint, in host: NSView) throws -> [NSColor?] {
        let bitmap = try #require(host.bitmapImageRepForCachingDisplay(in: host.bounds))
        host.cacheDisplay(in: host.bounds, to: bitmap)
        let scale = CGFloat(bitmap.pixelsWide) / host.bounds.width
        return (-6 ... 6).flatMap { row in
          (-6 ... 6).map { column in
            bitmap.colorAt(x: Int((point.x + CGFloat(column)) * scale), y: Int((point.y + CGFloat(row)) * scale))
          }
        }
      }

      private static func menuAreas(in view: NSView) -> [MessageContextMenuView] {
        ((view as? MessageContextMenuView).map { [$0] } ?? []) + view.subviews.flatMap(menuAreas)
      }

      /// The inline edit composer sits inside the row; its text view keeps AppKit's editing menu.
      @Test func theEditComposerInsideTheRowKeepsItsEditingMenu() async throws {
        let fixture = try await Self.fixture(editingRow: true)
        defer { fixture.close() }
        let menu = try await fixture.rightClick(at: fixture.textCenter, in: fixture.text)
        let actions = Set(menu?.items.compactMap { $0.action.map(NSStringFromSelector) } ?? [])
        #expect(actions.isSuperset(of: ["cut:", "copy:", "paste:"]), "\(outline(menu))")
      }

      /// The room composer is not a message row and keeps its editing menu.
      @Test func theComposerKeepsItsEditingMenu() throws {
        let input = MacComposerTextInput.InputView()
        let event = try #require(NSEvent.mouseEvent(with: .rightMouseDown, location: .zero, modifierFlags: [], timestamp: 0,
                                                    windowNumber: 0, context: nil, eventNumber: 0, clickCount: 1, pressure: 1))
        let actions = Set(input.menu(for: event)?.items.compactMap { $0.action.map(NSStringFromSelector) } ?? [])
        #expect(actions.isSuperset(of: ["cut:", "copy:", "paste:"]))
      }
    }
  }
#endif

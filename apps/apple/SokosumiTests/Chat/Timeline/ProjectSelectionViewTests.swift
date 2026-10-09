#if os(macOS)
  import AppKit
  import CoreAPI
  @testable import Sokosumi
  import SokosumiChat
  import SwiftUI
  import Testing

  /// Holds a pick open until the test answers it.
  @MainActor private final class PickGate {
    private(set) var picks: [[String]] = []
    var failure: (any Error)?
    private var waiter: CheckedContinuation<Void, Never>?

    func select(_ previewId: String, _ projectId: String) async throws {
      picks.append([previewId, projectId])
      await withCheckedContinuation { waiter = $0 }
      if let failure {
        self.failure = nil
        throw failure
      }
    }

    func release() {
      waiter?.resume()
      waiter = nil
    }
  }

  private struct SendFailed: Error {}

  /// The result-card suite's hosting, waiting and accessibility helpers.
  private typealias Helpers = NativeWindowTests.SokoBotResultPreviewsTests

  extension NativeWindowTests {
    /// Row 38h1: a Soko Bot's project question and the reply that answers it (web `ChatProjectSelection` and
    /// `ProjectSelectionMessage`, #5806). Words and controls come from the hosted views' accessibility nodes.
    @MainActor struct ProjectSelectionViewTests {
      private static let created = Date(timeIntervalSince1970: 1_791_381_900)
      private static let preview = "7d1f0c2a-0000-4000-8000-000000000007"
      private static let books = "0b5e0e7a-0000-4000-8000-0000000000a1"
      private static let launch = "0b5e0e7a-0000-4000-8000-0000000000a2"

      private static func question(options: [(id: String, name: String)]) -> ResultPreviewItem {
        .available(ResultPreviewCard(.init(
          id: preview, state: .available, capturedAt: created, kind: .projectSelection, title: "Choose a project", status: nil,
          sourceHref: "/projects", projectOptions: options.map { .init(id: $0.id, name: $0.name, identifier: nil, logo: nil) }
        ), webBaseURL: CoreSettings.webBaseURL))
      }

      private static let options = [(id: books, name: "Books"), (id: launch, name: "Launch")]

      private static func reply(_ content: String) -> Components.Schemas.ChatRoomMessage {
        .init(id: "reply", roomId: "room", content: content, createdAt: created,
              sender: .case1(.init(_type: .user, user: .init(id: "user_1", name: "Ada", email: "ada@example.com", image: nil, presence: .offline))),
              mentions: [], reactions: [], threadReplyCount: 0)
      }

      // MARK: The reply

      /// Web: a reply in the picker's exact format is the chosen project's chip, linked to the project on web; the
      /// raw sentence and id never show.
      @Test func aReplyShowsTheChosenProjectAsAChip() async throws {
        var opened: [URL] = []
        let row = MessageRowView(message: Self.reply(#"Use project "Books" (project ID: \#(Self.books))."#),
                                 isContinuation: false, outbound: nil, onRetry: nil, onRemove: nil)
          .environment(\.openURL, OpenURLAction { opened.append($0)
            return .handled
          })
        let (window, host) = Helpers.window(row, size: NSSize(width: 560, height: 160))
        defer { window.orderOut(nil) }
        let texts = try await Helpers.waitForText("Selected project", in: host)
        #expect(texts.contains("Books"), "\(texts)")
        #expect(!texts.contains { $0.contains("Use project") || $0.contains(Self.books) }, "\(texts)")
        let chip = try #require(await Helpers.nodes(labelled: "Books", in: host).first)
        #expect(chip.press())
        await Helpers.settle(host)
        #expect(opened == [ProjectSelection.projectURL(projectId: Self.books, webBaseURL: CoreSettings.webBaseURL)])
      }

      // MARK: The question

      /// Web: the card is only the picker; picking disables it under "Sending your choice…", and the sent choice
      /// replaces it with the chosen project's chip.
      @Test func pickingAProjectSendsItAndShowsTheChoice() async throws {
        let gate = PickGate()
        var opened: [URL] = []
        let card = ResultPreviewCardView(item: Self.question(options: Self.options), select: { try await gate.select($0, $1) })
          .environment(\.openURL, OpenURLAction { opened.append($0)
            return .handled
          })
        let (window, host) = Helpers.window(card.padding(12), size: NSSize(width: 480, height: 200))
        defer { window.orderOut(nil) }
        _ = try await Helpers.waitForText("Choose a project", in: host)
        let trigger = try #require(await Helpers.nodes(labelled: "Choose a project", in: host).last)
        #expect(trigger.press())
        let books = try #require(await Self.popoverNode(labelled: "Books"))
        #expect(await Self.popoverNode(labelled: "Launch") != nil)
        #expect(books.press())
        _ = try await Helpers.waitForText("Sending your choice…", in: host)
        #expect(gate.picks == [[Self.preview, Self.books]])
        gate.release()
        // Web's `role="status"` "Selected {name}"; the chip inside still opens the project.
        let texts = try await Helpers.waitForText("Selected Books", in: host)
        #expect(!texts.contains("Sending your choice…"))
        #expect(try #require(await Helpers.nodes(labelled: "Selected Books", in: host).first).press())
        await Helpers.settle(host)
        #expect(opened == [ProjectSelection.projectURL(projectId: Self.books, webBaseURL: CoreSettings.webBaseURL)])
      }

      /// Web: a failed send says so under the picker, which stays for another try.
      @Test func aFailedSendSaysSoAndKeepsThePicker() async throws {
        let gate = PickGate()
        gate.failure = SendFailed()
        let card = ResultPreviewCardView(item: Self.question(options: Self.options), select: { try await gate.select($0, $1) })
        let (window, host) = Helpers.window(card.padding(12), size: NSSize(width: 480, height: 200))
        defer { window.orderOut(nil) }
        _ = try await Helpers.waitForText("Choose a project", in: host)
        #expect(try #require(await Helpers.nodes(labelled: "Choose a project", in: host).last).press())
        #expect(try #require(await Self.popoverNode(labelled: "Launch")).press())
        _ = try await Helpers.waitForText("Sending your choice…", in: host)
        gate.release()
        let texts = try await Helpers.waitForText("Could not send your choice. Please try again.", in: host)
        #expect(!texts.contains("Selected project"))
        #expect(await Helpers.nodes(labelled: "Choose a project", in: host).count >= 2, "\(texts)")
      }

      /// Web: no options, or nowhere to send the choice, leaves only "No projects available…".
      @Test(arguments: [true, false])
      func aQuestionWithNothingToPickSaysSo(hasOptions: Bool) async throws {
        let card = ResultPreviewCardView(item: Self.question(options: hasOptions ? Self.options : []),
                                         select: hasOptions ? nil : { _, _ in })
        let (window, host) = Helpers.window(card.padding(12), size: NSSize(width: 480, height: 160))
        defer { window.orderOut(nil) }
        _ = try await Helpers.waitForText("No projects available. Ask the bot to refresh the choices.", in: host)
      }

      /// Web's search: the list narrows to matching names, Return picks the first, nothing matching says so.
      @Test func theSearchNarrowsAndReturnPicksTheFirstMatch() async throws {
        guard case let .available(card) = Self.question(options: Self.options) else { return }
        var picked: [String] = []
        let list = ProjectPickerList(options: card.projectOptions) { picked.append($0.id) }
        let (window, host) = Helpers.window(list, size: NSSize(width: 300, height: 220))
        defer { window.orderOut(nil) }
        _ = try await Helpers.waitForText("Launch", in: host)
        window.makeKey()
        await Helpers.settle(host)
        let field = try #require(Self.textField(in: host))
        field.stringValue = "laun"
        NotificationCenter.default.post(name: NSControl.textDidChangeNotification, object: field)
        await Helpers.settle(host)
        let texts = await hostedTexts(in: host)
        #expect(texts.contains("Launch") && !texts.contains("Books"), "\(texts)")
        field.sendAction(field.action, to: field.target)
        await Helpers.settle(host)
        #expect(picked == [Self.launch])
        field.stringValue = "zzz"
        NotificationCenter.default.post(name: NSControl.textDidChangeNotification, object: field)
        _ = try await Helpers.waitForText("No projects available. Ask the bot to refresh the choices.", in: host)
      }

      // MARK: Render

      /// Light beside dark: a reply's chip, the question's picker, its open list, the sending and failed states and
      /// the answered card, each hosted over the window background.
      @Test func rendersTheQuestionAndTheReply() async throws {
        var columns: [[CGImage]] = []
        for dark in [false, true] {
          let sending = PickGate()
          let failing = PickGate()
          failing.failure = SendFailed()
          let answered = PickGate()
          guard case let .available(card) = Self.question(options: Self.options + [(id: "p3", name: "Quarterly planning")]) else { return }
          let size = NSSize(width: 520, height: 120)
          try await columns.append([
            Helpers.draw(MessageRowView(message: Self.reply(#"Use project "Books" (project ID: \#(Self.books))."#),
                                        isContinuation: false, outbound: nil, onRetry: nil, onRemove: nil).padding(12),
                         size: size, dark: dark, until: "Selected project"),
            Helpers.draw(ResultPreviewCardView(item: .available(card), select: { _, _ in }).padding(12),
                         size: size, dark: dark, until: "Choose a project"),
            // As the popover draws it: the list on its own rounded surface.
            Helpers.draw(ProjectPickerList(options: card.projectOptions) { _ in }
              .background(.background, in: .rect(cornerRadius: 10))
              .overlay { RoundedRectangle(cornerRadius: 10).stroke(.quaternary) }
              .padding(12), size: NSSize(width: 520, height: 200), dark: dark, until: "Quarterly planning"),
            Self.drawPicked(card, gate: sending, dark: dark, until: "Sending your choice…", release: false),
            Self.drawPicked(card, gate: failing, dark: dark, until: "Could not send your choice. Please try again.", release: true),
            Self.drawPicked(card, gate: answered, dark: dark, until: "Selected Books", release: true)
          ])
          sending.release()
        }
        let combined = try RoomHeaderTests.stitched(columns)
        try Attachment.record(#require(combined.representation(using: .png, properties: [:])), named: "soko-bot-project-picker.png")
      }

      // MARK: Helpers

      /// Hosts the card as `Helpers.draw` does, picks Books through the popover (answering the send when `release`),
      /// then draws it once `text` shows.
      private static func drawPicked(_ card: ResultPreviewCard, gate: PickGate, dark: Bool, until text: String, release: Bool) async throws -> CGImage {
        let size = NSSize(width: 520, height: 120)
        let host = NSHostingView(rootView: ResultPreviewCardView(item: .available(card), select: { try await gate.select($0, $1) })
          .padding(12)
          .frame(width: size.width, height: size.height, alignment: .topLeading)
          .background(.background)
          .environment(\.locale, Locale(identifier: "en_US"))
          .environment(\.colorScheme, dark ? .dark : .light))
        let window = NSWindow(contentRect: NSRect(origin: .zero, size: size), styleMask: [.titled], backing: .buffered, defer: false)
        window.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        window.contentView = host
        window.orderFront(nil)
        defer { window.orderOut(nil) }
        _ = try await Helpers.waitForText("Choose a project", in: host)
        #expect(try #require(await Helpers.nodes(labelled: "Choose a project", in: host).last).press())
        #expect(try #require(await popoverNode(labelled: "Books")).press())
        _ = try await Helpers.waitForText("Sending your choice…", in: host)
        if release {
          gate.release()
        }
        _ = try await Helpers.waitForText(text, in: host)
        await Helpers.settle(host)
        let bitmap = try #require(host.bitmapImageRepForCachingDisplay(in: host.bounds))
        host.cacheDisplay(in: host.bounds, to: bitmap)
        try CreateChannelGuidanceTests.expectWindowBackground(bitmap, dark: dark)
        return try #require(bitmap.cgImage)
      }

      /// A node in an open popover's window.
      private static func popoverNode(labelled label: String) async -> ResultsNode? {
        let deadline = ContinuousClock.now.advanced(by: .seconds(5))
        repeat {
          for window in NSApp.windows where window.isVisible && String(describing: type(of: window)).contains("Popover") {
            if let host = window.contentView, let node = await Helpers.nodes(labelled: label, in: host).first {
              return node
            }
          }
          try? await Task.sleep(for: .milliseconds(25))
        } while ContinuousClock.now < deadline
        return nil
      }

      private static func textField(in view: NSView) -> NSTextField? {
        if let field = view as? NSTextField, field.isEditable {
          return field
        }
        return view.subviews.lazy.compactMap { textField(in: $0) }.first
      }
    }
  }
#endif

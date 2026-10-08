#if os(macOS)
  import AppKit
  import CoreAPI
  import OpenAPIRuntime
  @testable import Sokosumi
  import SokosumiChat
  import SwiftUI
  import Testing

  /// Lets a test hold the results read open and answer it when it chooses.
  @MainActor private final class ResultsGate {
    private var waiters: [CheckedContinuation<Void, Never>] = []
    private(set) var reads = 0
    var answers: [Result<[Components.Schemas.ChatResultPreview], any Error>] = []

    func load() async throws -> [Components.Schemas.ChatResultPreview] {
      reads += 1
      await withCheckedContinuation { waiters.append($0) }
      return try answers.removeFirst().get()
    }

    func release() {
      let pending = waiters
      waiters = []
      pending.forEach { $0.resume() }
    }
  }

  private struct ResultsUnavailable: Error {}

  /// One of SwiftUI's accessibility nodes, pressed the way VoiceOver presses it.
  private struct ResultsNode {
    let object: NSObject

    func press() -> Bool {
      let selector = NSSelectorFromString("accessibilityPerformPress")
      guard object.responds(to: selector) else { return false }
      typealias Press = @convention(c) (NSObject, Selector) -> Bool
      return unsafeBitCast(object.method(for: selector), to: Press.self)(object, selector)
    }
  }

  extension NativeWindowTests {
    /// Row 38e1: a Soko Bot message's recorded results (web `ResultPreviews`, #5806). The row reads its cards,
    /// says so while it reads and when the read failed, draws the generic and the locked card, opens their sources
    /// and outputs on web, and drops the footer's Task button for a Task a card shows. Words and controls come
    /// from the hosted view's accessibility nodes, never from pixels.
    @MainActor struct SokoBotResultPreviewsTests {
      private static let created = Date(timeIntervalSince1970: 1_791_381_900)
      private static let taskCard = "7d1f0c2a-0000-4000-8000-000000000004"
      private static let schedule = "7d1f0c2a-0000-4000-8000-000000000001"
      private static let job = "7d1f0c2a-0000-4000-8000-000000000003"
      private static let locked = "7d1f0c2a-0000-4000-8000-000000000002"

      private static func message(descriptors: [String]) throws -> Components.Schemas.ChatRoomMessage {
        try .init(
          id: "reply", roomId: "room", content: "Done: the schedule is set and the scan is in.",
          resultPreviews: descriptors.map { .init(id: $0, capturedAt: created) }, createdAt: created,
          sender: .case3(.init(_type: .sokoBot, sokoBot: .init(id: "bot_1", name: "Soko", caption: nil, image: nil, avatarSeed: nil,
                                                               ownerUserId: "user_2", presence: .online))),
          mentions: [], reactions: [], threadReplyCount: 0,
          metadata: .init(additionalProperties: [
            "mention_id": OpenAPIValueContainer(unvalidatedValue: "mention_1"),
            "soko_bot": OpenAPIValueContainer(unvalidatedValue: ["turn_id": "turn_1", "pending_decision_ids": [] as [String],
                                                                 "task_ids": ["task 1", "task 2"]] as [String: any Sendable])
          ])
        )
      }

      private static let previews: [Components.Schemas.ChatResultPreview] = [
        .available(.init(id: taskCard, state: .available, capturedAt: created, kind: .task, title: "Review the draft",
                         status: "INPUT_REQUIRED", sourceHref: "/tasks/task%201", question: "Which version should I send?")),
        .available(.init(id: schedule, state: .available, capturedAt: created, kind: .taskSchedule, title: "Weekly report",
                         status: "ACTIVE", summary: "Compile the weekly numbers for the team.", sourceHref: "/schedules/sched-1",
                         assignee: "Elena", project: "Launch", scheduledAt: created.addingTimeInterval(5 * 86400),
                         timezone: "Europe/Berlin", recurrence: "0 9 * * 1")),
        .available(.init(id: job, state: .available, capturedAt: created, kind: .job, title: "Market scan", status: "completed",
                         summary: "Three competitors raised prices this quarter.", sourceHref: "/agents/ag-1/jobs/job-1", assignee: "Scout",
                         outputs: [.init(name: "report.pdf", contentType: "application/pdf", sizeBytes: 20480,
                                         openHref: "/api/jobs/job-1/files/blob-1/content", previewHref: "/api/jobs/job-1/files/blob-1/content",
                                         downloadHref: "/api/jobs/job-1/files/blob-1/content?download=true")],
                         agent: .init(name: "Scout", icon: nil))),
        .unavailable(.init(id: locked, state: .unavailable))
      ]

      private static func web(_ href: String) -> URL? {
        MessageResultPreviews.webURL(forLocalHref: href, webBaseURL: CoreSettings.webBaseURL)
      }

      // MARK: Reading

      /// Web: "Loading results…" with the footer's Task buttons while the read runs, then the cards in Core's
      /// order; a Task a card shows loses its button, the other keeps it.
      @Test func aRowReadsItsCardsAndKeepsOnlyTheTaskButtonsNoCardShows() async throws {
        let gate = ResultsGate()
        gate.answers = [.success(Self.previews)]
        var opened: [URL] = []
        let row = try MessageRowView(message: Self.message(descriptors: [Self.taskCard, Self.schedule, Self.job, Self.locked]),
                                     isContinuation: false, outbound: nil, onRetry: nil, onRemove: nil,
                                     loadResultPreviews: { try await gate.load() })
          .environment(\.openURL, OpenURLAction { opened.append($0)
            return .handled
          })
        let (window, host) = Self.window(row, size: NSSize(width: 640, height: 900))
        defer { window.orderOut(nil) }
        _ = try await Self.waitForText("Loading results…", in: host)
        #expect(await Self.pressAll("Task", in: host) == 2)
        #expect(opened == [Self.web("/tasks/task%201"), Self.web("/tasks/task%202")])

        opened = []
        gate.release()
        let texts = try await Self.waitForText("Weekly report", in: host)
        for text in ["Review the draft", "Which version should I send?", "Waiting for input", "Task schedule", "Active",
                     "Compile the weekly numbers for the team.", "Assigned to", "Elena", "Project", "Launch", "Scheduled for",
                     "Recurrence", "0 9 * * 1", "Agent result", "Market scan", "Completed", "Result unavailable or no longer accessible"] {
          #expect(texts.contains(text), "\(text) missing from \(texts)")
        }
        #expect(!texts.contains("Loading results…"))
        #expect(gate.reads == 1)
        // Only the second Task keeps its button; the card's kind label is no button.
        _ = await Self.pressAll("Task", in: host)
        #expect(opened == [Self.web("/tasks/task%202")])
      }

      /// Web: a failed read says so beside Retry, keeps every Task button, and Retry reads again.
      @Test func aFailedReadOffersRetry() async throws {
        let gate = ResultsGate()
        gate.answers = [.failure(ResultsUnavailable()), .success([Self.previews[1]])]
        let row = try MessageRowView(message: Self.message(descriptors: [Self.schedule]),
                                     isContinuation: false, outbound: nil, onRetry: nil, onRemove: nil,
                                     loadResultPreviews: { try await gate.load() })
        let (window, host) = Self.window(row, size: NSSize(width: 640, height: 500))
        defer { window.orderOut(nil) }
        _ = try await Self.waitForText("Loading results…", in: host)
        gate.release()
        _ = try await Self.waitForText("Results could not be loaded", in: host)
        let retry = try #require(await Self.nodes(labelled: "Retry", in: host).first)
        #expect(retry.press())
        _ = try await Self.waitForText("Loading results…", in: host)
        gate.release()
        _ = try await Self.waitForText("Weekly report", in: host)
        #expect(gate.reads == 2)
      }

      // MARK: Opening

      /// Web: the card opens `sourceHref`, an output opens its `openHref` and Download its `downloadHref`, all on web.
      @Test func aCardOpensItsSourceAndOutputsOnWeb() async throws {
        guard case let .available(result) = Self.previews[2] else { return }
        var opened: [URL] = []
        let card = ResultPreviewCardView(item: .available(ResultPreviewCard(result, webBaseURL: CoreSettings.webBaseURL)))
          .environment(\.openURL, OpenURLAction { opened.append($0)
            return .handled
          })
        let (window, host) = Self.window(card.padding(12), size: NSSize(width: 620, height: 360))
        defer { window.orderOut(nil) }
        _ = try await Self.waitForText("Market scan", in: host)
        let texts = await hostedTexts(in: host)
        #expect(texts.contains { $0.contains("report.pdf · application/pdf · 20,480 bytes") }, "\(texts)")
        let source = try #require(await Self.nodes(labelled: "Open source: Market scan", in: host).first, "\(texts)")
        #expect(source.press())
        let output = try #require(await Self.nodes(containing: "report.pdf · ", in: host).first)
        #expect(output.press())
        let download = try #require(await Self.nodes(labelled: "Download report.pdf", in: host).first)
        #expect(download.press())
        await Self.settle(host)
        #expect(opened == [Self.web("/agents/ag-1/jobs/job-1"), Self.web("/api/jobs/job-1/files/blob-1/content"),
                           Self.web("/api/jobs/job-1/files/blob-1/content?download=true")])
      }

      /// A row without a reader (a pin's preview, a search hit) draws the footer alone, every Task button included.
      @Test func aRowWithoutAReaderKeepsTheFooter() async throws {
        let row = try MessageRowView(message: Self.message(descriptors: [Self.taskCard]),
                                     isContinuation: false, outbound: nil, onRetry: nil, onRemove: nil)
        let (window, host) = Self.window(row, size: NSSize(width: 640, height: 300))
        defer { window.orderOut(nil) }
        _ = try await Self.waitForText("Done: the schedule is set and the scan is in.", in: host)
        await Self.settle(host)
        let texts = await hostedTexts(in: host)
        #expect(texts.filter { $0 == "Task" }.count == 2, "\(texts)")
        #expect(!texts.contains("Loading results…"))
      }

      // MARK: Render

      /// Light beside dark: the reading line, then a row with a schedule card, a job card with its output, a locked
      /// card and the footer's remaining Task button, each hosted over the window background.
      @Test func rendersTheCards() async throws {
        var columns: [[CGImage]] = []
        for dark in [false, true] {
          let loading = ResultsGate()
          let loaded = ResultsGate()
          loaded.answers = [.success(Self.previews)]
          let readingRow = try MessageRowView(message: Self.message(descriptors: [Self.schedule]),
                                              isContinuation: false, outbound: nil, onRetry: nil, onRemove: nil,
                                              loadResultPreviews: { try await loading.load() })
          let row = try MessageRowView(message: Self.message(descriptors: [Self.taskCard, Self.schedule, Self.job, Self.locked]),
                                       isContinuation: false, outbound: nil, onRetry: nil, onRemove: nil,
                                       loadResultPreviews: { try await loaded.load() })
          let reading = try await Self.draw(readingRow.padding(12), size: NSSize(width: 640, height: 150), dark: dark, until: "Loading results…")
          loading.answers = [.success([])]
          loading.release()
          try await columns.append([
            reading,
            Self.draw(row.padding(12), size: NSSize(width: 640, height: 1010), dark: dark, until: "Result unavailable or no longer accessible") { loaded.release() }
          ])
        }
        let combined = try RoomHeaderTests.stitched(columns)
        try Attachment.record(#require(combined.representation(using: .png, properties: [:])), named: "soko-bot-result-previews.png")
      }

      // MARK: Helpers

      private static func window(_ content: some View, size: NSSize) -> (NSWindow, NSView) {
        let host = NSHostingView(rootView: content.frame(width: size.width, height: size.height, alignment: .topLeading).background(.background)
          .environment(\.locale, Locale(identifier: "en_US")))
        let window = NSWindow(contentRect: NSRect(origin: .zero, size: size), styleMask: [.titled], backing: .buffered, defer: false)
        window.contentView = host
        window.orderFront(nil)
        return (window, host)
      }

      private static func draw(_ content: some View, size: NSSize, dark: Bool, until text: String, poke: () -> Void = {}) async throws -> CGImage {
        let host = NSHostingView(rootView: content
          .frame(width: size.width, height: size.height, alignment: .topLeading)
          .background(.background)
          .environment(\.locale, Locale(identifier: "en_US"))
          .environment(\.colorScheme, dark ? .dark : .light))
        let window = NSWindow(contentRect: NSRect(origin: .zero, size: size), styleMask: [.titled], backing: .buffered, defer: false)
        window.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        window.ignoresMouseEvents = true
        window.contentView = host
        window.orderFront(nil)
        defer { window.orderOut(nil) }
        await settle(host)
        poke()
        _ = try await waitForText(text, in: host)
        await settle(host)
        let bitmap = try #require(host.bitmapImageRepForCachingDisplay(in: host.bounds))
        host.cacheDisplay(in: host.bounds, to: bitmap)
        try CreateChannelGuidanceTests.expectWindowBackground(bitmap, dark: dark)
        return try #require(bitmap.cgImage)
      }

      private static func settle(_ host: NSView) async {
        for _ in 0 ..< 8 {
          await Task.yield()
          host.layoutSubtreeIfNeeded()
          try? await Task.sleep(for: .milliseconds(25))
        }
      }

      private static func waitForText(_ text: String, in host: NSView) async throws -> [String] {
        let deadline = ContinuousClock.now.advanced(by: .seconds(10))
        var texts: [String] = []
        repeat {
          host.layoutSubtreeIfNeeded()
          texts = await hostedTexts(in: host)
          if texts.contains(where: { $0 == text || $0.components(separatedBy: ", ").contains(text) }) {
            return texts
          }
          try await Task.sleep(for: .milliseconds(25))
        } while ContinuousClock.now < deadline
        Issue.record("\"\(text)\" never showed: \(texts)")
        return texts
      }

      /// Presses every node labelled exactly `label` and says how many took the press.
      private static func pressAll(_ label: String, in host: NSView) async -> Int {
        var pressed = 0
        for node in await nodes(labelled: label, in: host) where node.press() {
          pressed += 1
        }
        await settle(host)
        return pressed
      }

      private static func nodes(labelled label: String, in host: NSView) async -> [ResultsNode] {
        await nodes(in: host) { $0 == label }
      }

      private static func nodes(containing text: String, in host: NSView) async -> [ResultsNode] {
        await nodes(in: host) { $0 == text || $0.contains(text) }
      }

      /// Accessibility nodes, parents before children, whose label matches.
      private static func nodes(in host: NSView, where matches: (String) -> Bool) async -> [ResultsNode] {
        _ = await hostedTexts(in: host)
        var seen: Set<ObjectIdentifier> = []
        var found: [ResultsNode] = []
        func walk(_ element: Any) {
          guard let object = element as? NSObject, seen.insert(ObjectIdentifier(object)).inserted else { return }
          if object.responds(to: NSSelectorFromString("accessibilityLabel")),
             let label = object.value(forKey: "accessibilityLabel") as? String, matches(label) {
            found.append(ResultsNode(object: object))
          }
          if object.responds(to: NSSelectorFromString("accessibilityChildren")) {
            for child in (object.value(forKey: "accessibilityChildren") as? [Any]) ?? [] {
              walk(child)
            }
          }
          for subview in (object as? NSView)?.subviews ?? [] {
            walk(subview)
          }
        }
        walk(host)
        return found
      }
    }
  }
#endif

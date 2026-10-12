#if os(macOS)
  import AppKit
  import CoreAPI
  @testable import Sokosumi
  import SokosumiChat
  import SwiftUI
  import Testing

  /// The result-card suite's hosting, waiting and accessibility helpers.
  private typealias Helpers = NativeWindowTests.SokoBotResultPreviewsTests
  private typealias Person = Components.Schemas.ChatResultAvailable.TaskPayload.ParticipantsPayloadPayload

  extension NativeWindowTests {
    /// Row 38f: a Soko Bot's `task` result draws web's Task card (`TaskCard` in `task-card.tsx`, as
    /// `result-previews.tsx` passes it) inside the result's header, question and footer. Words and controls come
    /// from the hosted view's accessibility nodes.
    @MainActor struct SokoBotTaskCardTests {
      private static let created = Date(timeIntervalSince1970: 1_791_381_900)
      private static let review = "7d1f0c2a-0000-4000-8000-000000000021"
      private static let launchPlan = "7d1f0c2a-0000-4000-8000-000000000022"
      private static let export = "7d1f0c2a-0000-4000-8000-000000000023"
      private static let adaImage = Helpers.fixtureImage("task-ada", red: 0.85, green: 0.45, blue: 0.2)
      private static let launchLogo = Helpers.fixtureImage("task-logo", red: 0.2, green: 0.55, blue: 0.4)

      /// Private, high priority, waiting for input: three tags, a project with a logo, an assignee who is also a
      /// participant, three more people, comments and a start an hour and a half away.
      private static func reviewCard(now: Date = Date()) -> ResultPreviewCard {
        ResultPreviewCard(.init(
          id: review, state: .available, capturedAt: created, kind: .task, title: "Review the draft", status: "INPUT_REQUIRED",
          summary: "Read it and pick the version to send.", sourceHref: "/tasks/task_1", assignee: "Ada Lovelace", project: "Launch",
          question: "Which version should I send?",
          task: .init(
            id: "task_1", name: "Review the draft", identifier: "LAU-7", status: .inputRequired, priority: .high,
            visibility: ._private, createdAt: created, runAt: now.addingTimeInterval(90 * 60),
            project: .init(id: "project_1", name: "Launch", identifier: "LAU", logo: launchLogo),
            assignee: .init(id: "user_1", name: "Ada Lovelace", image: adaImage, kind: .user),
            participants: [
              Person(id: "user_1", name: "Ada Lovelace", image: adaImage, kind: .user),
              Person(id: "user_2", name: "Grace Hopper", kind: .user), Person(id: "user_3", name: "Alan Turing", kind: .user),
              Person(id: "user_4", name: "Edsger Dijkstra", kind: .user)
            ],
            commentsCount: 4, tags: .init(automatic: [.research, .writing], manual: [.design], rejected: [])
          )
        ), webBaseURL: CoreSettings.webBaseURL)
      }

      /// Running, urgent, in a project, no tags, one coworker.
      private static let launchPlanCard = ResultPreviewCard(.init(
        id: launchPlan, state: .available, capturedAt: created, kind: .task, title: "Draft the launch plan", status: "RUNNING",
        sourceHref: "/tasks/task_2",
        task: .init(
          id: "task_2", name: "Draft the launch plan for the autumn release and line up the press list", identifier: "LAU-8",
          status: .running, priority: .urgent, visibility: ._public, createdAt: created,
          project: .init(id: "project_1", name: "Launch", identifier: "LAU", logo: nil),
          assignee: .init(id: "cw_1", name: "Scout", kind: .coworker, slug: "scout"),
          participants: [], commentsCount: 0, tags: .init(automatic: [], manual: [], rejected: [])
        )
      ), webBaseURL: CoreSettings.webBaseURL)

      /// Failed, no priority, no project, no tags, nobody on it.
      private static let exportCard = ResultPreviewCard(.init(
        id: export, state: .available, capturedAt: created, kind: .task, title: "Export the CRM", status: "FAILED",
        sourceHref: "/tasks/task_3",
        task: .init(
          id: "task_3", name: "Export the CRM", status: .failed, priority: .none, visibility: ._public, createdAt: created,
          participants: [], commentsCount: 0, tags: .init(automatic: [], manual: [], rejected: [])
        )
      ), webBaseURL: CoreSettings.webBaseURL)

      private static func web(_ href: String) -> URL? {
        MessageResultPreviews.webURL(forLocalHref: href, webBaseURL: CoreSettings.webBaseURL)
      }

      // MARK: What it shows

      /// Web's Task card replaces the generic chip, title, summary and rows; the header, question and footer stay.
      @Test func aTaskResultDrawsWebsTaskCard() async throws {
        let card = ResultPreviewCardView(item: .available(Self.reviewCard()))
        let (window, host) = Helpers.window(card.padding(12), size: NSSize(width: 620, height: 520))
        defer { window.orderOut(nil) }
        let texts = try await Helpers.waitForText("Input required", in: host)
        for text in ["Task", "Private", "High", "LAU-7 Review the draft", "Tags", "Design", "Research", "Show all 3 tags",
                     "Open project: Launch", "Starts in 2 hours", "Ada Lovelace, Grace Hopper, Alan Turing, Edsger Dijkstra", "4",
                     "Oct 7", "Which version should I send?", "Open source: Review the draft"] {
          #expect(texts.contains(text), "\(text) missing from \(texts)")
        }
        // The third tag waits behind "+1"; the generic card's chip, summary and rows are gone.
        for text in ["Writing", "Waiting for input", "Read it and pick the version to send.", "Assigned to", "Project"] {
          #expect(!texts.contains(text), "\(text) shown in \(texts)")
        }
      }

      /// Web's empty states: no project, no tags, an unknown face; no priority mark, lock, comments or start.
      @Test func aBareTaskSaysWhatItLacks() async throws {
        let card = ResultPreviewCardView(item: .available(Self.exportCard))
        let (window, host) = Helpers.window(card.padding(12), size: NSSize(width: 620, height: 360))
        defer { window.orderOut(nil) }
        let texts = try await Helpers.waitForText("Failed", in: host)
        for text in ["Export the CRM", "No tags yet", "No project", "—", "Oct 7"] {
          #expect(texts.contains(text), "\(text) missing from \(texts)")
        }
        for text in ["Private", "No priority", "Tags"] {
          #expect(!texts.contains(text), "\(text) shown in \(texts)")
        }
        #expect(!texts.contains { $0.hasPrefix("Start") }, "\(texts)")
      }

      // MARK: Where it goes

      /// The Task opens at web's `taskHref`, the project at its page, the rest of the result at `sourceHref`.
      @Test func theCardOpensItsTaskItsProjectAndItsSource() async throws {
        var opened: [URL] = []
        let card = ResultPreviewCardView(item: .available(Self.reviewCard()))
          .environment(\.openURL, OpenURLAction { opened.append($0)
            return .handled
          })
        let (window, host) = Helpers.window(card.padding(12), size: NSSize(width: 620, height: 520))
        defer { window.orderOut(nil) }
        _ = try await Helpers.waitForText("Input required", in: host)
        #expect(try #require(await Helpers.nodes(labelled: "LAU-7 Review the draft", in: host).first).press())
        #expect(try #require(await Helpers.nodes(labelled: "Open project: Launch", in: host).first).press())
        #expect(try #require(await Helpers.nodes(labelled: "Open source: Review the draft", in: host).first).press())
        await Helpers.settle(host)
        #expect(opened == [Self.web("/tasks/LAU-7-review-the-draft"), Self.web("/projects/project_1"), Self.web("/tasks/task_1")])
      }

      /// Web's "+1" opens a popover listing every tag under "Tags".
      @Test func theCountListsEveryTag() async throws {
        let card = ResultPreviewCardView(item: .available(Self.reviewCard()))
        let (window, host) = Helpers.window(card.padding(12), size: NSSize(width: 620, height: 520))
        defer { window.orderOut(nil) }
        _ = try await Helpers.waitForText("Input required", in: host)
        #expect(try #require(await Helpers.nodes(labelled: "Show all 3 tags", in: host).first).press())
        // The popover window resolves its words in the system's language, not the host's `en_US` environment, so
        // it is checked by its count (the title and three tags) and the one tag English and German name alike.
        var texts: [String] = []
        let deadline = ContinuousClock.now.advanced(by: .seconds(10))
        repeat {
          if let popover = NSApp.windows.first(where: { $0.isVisible && String(describing: type(of: $0)).contains("Popover") }),
             let content = popover.contentView {
            texts = await hostedTexts(in: content)
          }
          try await Task.sleep(for: .milliseconds(50))
        } while !texts.contains("Design") && ContinuousClock.now < deadline
        #expect(texts.count == 4 && texts.contains("Design"), "\(texts)")
        for window in NSApp.windows where window.isVisible && String(describing: type(of: window)).contains("Popover") {
          window.orderOut(nil)
        }
      }

      // MARK: Render

      /// Light beside dark: a private Task waiting for input with everything web's card shows, a running urgent
      /// one and a failed bare one, each in its result's header and footer over the window background.
      @Test func rendersTheTaskCards() async throws {
        var columns: [[CGImage]] = []
        for dark in [false, true] {
          let content = VStack(alignment: .leading, spacing: 16) {
            ResultPreviewCardView(item: .available(Self.reviewCard()))
            ResultPreviewCardView(item: .available(Self.launchPlanCard))
            ResultPreviewCardView(item: .available(Self.exportCard))
          }
          .padding(12)
          try await columns.append([
            Helpers.draw(content, size: NSSize(width: 440, height: 860), dark: dark, until: "Export the CRM") {} ready: {
              // The avatar and the logo still decode off the main thread.
              try await Task.sleep(for: .milliseconds(600))
            }
          ])
        }
        let combined = try RoomHeaderTests.stitched(columns)
        try Attachment.record(#require(combined.representation(using: .png, properties: [:])), named: "soko-bot-task-cards.png")
      }
    }
  }
#endif

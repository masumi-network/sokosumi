#if os(macOS)
  import AppKit
  import CoreAPI
  import HTTPTypes
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

  /// Core's content operation answering with fixed bytes, so the stub loader below returns a real `ResultOutputFile`.
  private struct OutputBytesTransport: ClientTransport {
    let bytes: Data

    func send(_: HTTPRequest, body _: HTTPBody?, baseURL _: URL, operationID _: String) async throws -> (HTTPResponse, HTTPBody?) {
      (HTTPResponse(status: .ok), HTTPBody(bytes))
    }
  }

  /// Row 38e2: stands in for the coordinator (which loads) and for Quick Look and the save panel (which present), and
  /// records what each was asked.
  @MainActor private final class OutputRecorder: ResultOutputLoading, ResultOutputPresenting {
    private(set) var loads: [ResultOutputSource] = []
    private(set) var previewed: [String] = []
    private(set) var saved: [String] = []
    /// Loads that handed back a file.
    private(set) var answered = 0
    /// When set, every load fails with it.
    var failure: (any Error)?
    let image: Data

    init(image: Data) {
      self.image = image
    }

    func file(_ source: ResultOutputSource, named fileName: String) async throws -> ResultOutputFile {
      loads.append(source)
      if let failure {
        throw failure
      }
      let bytes = fileName.hasSuffix(".png") ? image : Data("fixture \(fileName)".utf8)
      let client = try Client.connecting(to: #require(URL(string: "https://core.example/v1")), transport: OutputBytesTransport(bytes: bytes))
      let file = try await ChatService().resultOutput(client: client, source: source, fileName: fileName, organizationSlug: nil)
      answered += 1
      return file
    }

    func preview(_ file: ResultOutputFile) {
      previewed.append(file.url.lastPathComponent)
    }

    func save(_ file: ResultOutputFile) async throws {
      saved.append(file.url.lastPathComponent)
    }
  }

  /// One of SwiftUI's accessibility nodes, pressed the way VoiceOver presses it.
  struct ResultsNode {
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

      /// A solid square written once per run, so a card's avatar and logo load from a local file as from Core's URLs.
      private static func fixtureImage(_ name: String, red: CGFloat, green: CGFloat, blue: CGFloat) -> String {
        let url = FileManager.default.temporaryDirectory.appending(path: "result-card-\(name)-\(ProcessInfo.processInfo.processIdentifier).png")
        try? fixturePNG(width: 64, height: 64, red: red, green: green, blue: blue)?.write(to: url)
        return url.absoluteString
      }

      /// A solid rectangle with a light disc in its middle, as PNG bytes.
      private static func fixturePNG(width: Int, height: Int, red: CGFloat, green: CGFloat, blue: CGFloat) -> Data? {
        guard let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
                                      space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
        context.setFillColor(CGColor(red: red, green: green, blue: blue, alpha: 1))
        context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        context.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 0.85))
        let disc = CGFloat(min(width, height)) * 3 / 8
        context.fillEllipse(in: CGRect(x: (CGFloat(width) - disc) / 2, y: (CGFloat(height) - disc) / 2, width: disc, height: disc))
        return context.makeImage().flatMap { NSBitmapImageRep(cgImage: $0).representation(using: .png, properties: [:]) }
      }

      private static let actorImage = fixtureImage("actor", red: 0.85, green: 0.45, blue: 0.2)
      private static let projectLogo = fixtureImage("logo", red: 0.2, green: 0.55, blue: 0.4)

      private static let previews: [Components.Schemas.ChatResultPreview] = [
        .available(.init(id: taskCard, state: .available, capturedAt: created, kind: .task, title: "Review the draft",
                         status: "INPUT_REQUIRED", sourceHref: "/tasks/task%201", question: "Which version should I send?",
                         task: .init(id: "task 1", name: "Review the draft", status: .inputRequired, priority: .high, visibility: ._public,
                                     participants: [], commentsCount: 0, tags: .init(automatic: [], manual: [], rejected: [])))),
        .available(.init(id: schedule, state: .available, capturedAt: created, kind: .taskSchedule, title: "Weekly report",
                         status: "ACTIVE", summary: "Compile the weekly numbers for the team.", sourceHref: "/schedules/sched-1",
                         assignee: "Elena", project: "Launch", scheduledAt: created.addingTimeInterval(5 * 86400),
                         timezone: "Europe/Berlin", recurrence: "0 9 * * 1",
                         actor: .init(id: "user_3", name: "Ada Lovelace", image: actorImage, kind: .user),
                         projectInfo: .init(id: "project_1", name: "Launch", identifier: "LAU", logo: projectLogo))),
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

      /// Web's header: a schedule's `actor` avatar stands where the kind icon would, named like web's avatar `alt`.
      @Test func aScheduleCardShowsWhoItRunsAs() async throws {
        guard case let .available(result) = Self.previews[1] else { return }
        let card = ResultPreviewCardView(item: .available(ResultPreviewCard(result, webBaseURL: CoreSettings.webBaseURL)))
        let (window, host) = Self.window(card.padding(12), size: NSSize(width: 620, height: 360))
        defer { window.orderOut(nil) }
        let texts = try await Self.waitForText("Weekly report", in: host)
        #expect(texts.contains("Ada Lovelace"), "\(texts)")
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

      // MARK: Protected outputs (row 38e2)

      private static let outputs = "7d1f0c2a-0000-4000-8000-000000000005"
      private static let driveCard = "7d1f0c2a-0000-4000-8000-000000000006"
      private static let studio = "7d1f0c2a-0000-4000-8000-000000000007"
      private static let driveFile = "8a2e0d3b-0000-4000-8000-000000000021"
      private static let studioImage = fixturePNG(width: 320, height: 200, red: 0.85, green: 0.45, blue: 0.2) ?? Data()
      private static let chartImage = fixturePNG(width: 120, height: 120, red: 0.2, green: 0.45, blue: 0.75) ?? Data()

      private static func job(_ blob: String) -> String {
        "/api/jobs/job-1/files/\(blob)/content"
      }

      /// A job with an image, a PDF, an audio file and a CSV: three draw inline, the CSV is a row; each has Download.
      private static let outputsCard = ResultPreviewCard(.init(
        id: outputs, state: .available, capturedAt: created, kind: .job, title: "Market scan", status: "completed",
        summary: "Three competitors raised prices this quarter.", sourceHref: "/agents/ag-1/jobs/job-1", assignee: "Scout",
        outputs: [
          .init(name: "chart.png", contentType: "image/png", sizeBytes: 4096, openHref: job("blob-2"), previewHref: job("blob-2"),
                downloadHref: job("blob-2") + "?download=true"),
          .init(name: "report.pdf", contentType: "application/pdf", sizeBytes: 20480, openHref: job("blob-1"), previewHref: job("blob-1"),
                downloadHref: job("blob-1") + "?download=true"),
          .init(name: "briefing.m4a", contentType: "audio/mp4", sizeBytes: 512_000, openHref: job("blob-3"), previewHref: job("blob-3"),
                downloadHref: job("blob-3") + "?download=true"),
          .init(name: "data.csv", contentType: "text/csv", sizeBytes: 300, openHref: job("blob-4"), previewHref: job("blob-4"),
                downloadHref: job("blob-4") + "?download=true")
        ],
        agent: .init(name: "Scout", icon: nil)
      ), webBaseURL: CoreSettings.webBaseURL)

      /// A Drive file Office cannot preview inline: its row opens the Drive page on web, its Download saves in the app.
      private static let driveFileCard = ResultPreviewCard(.init(
        id: driveCard, state: .available, capturedAt: created, kind: .file, title: "plan.docx",
        sourceHref: "/drive/files/\(driveFile)?scope=me",
        outputs: [.init(name: "plan.docx", contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                        sizeBytes: 9000, openHref: "/drive/files/\(driveFile)?scope=me",
                        previewHref: "/api/drive/files/\(driveFile)/content?scope=me",
                        downloadHref: "/api/drive/files/\(driveFile)/content?scope=me&download=true")]
      ), webBaseURL: CoreSettings.webBaseURL)

      /// A Studio generation: its image is a large preview in the first of two columns, and has no Download.
      private static let studioCard = ResultPreviewCard(.init(
        id: studio, state: .available, capturedAt: created, kind: .studioJob, title: "A red fox at dawn", status: "SUCCEEDED",
        summary: "A red fox at dawn", sourceHref: "/studio?projectId=p1&v=a1",
        outputs: [.init(name: "A red fox at dawn", contentType: "image/png", sizeBytes: 182_000, openHref: "/studio?projectId=p1&v=a1",
                        previewHref: "/api/projects/p1/image-studio/assets/a1/content")]
      ), webBaseURL: CoreSettings.webBaseURL)

      /// Web draws the image, PDF and audio inline and the CSV as a row; Apple loads each through Core with the
      /// session, previews it in Quick Look and saves Download through the save panel. Only the image loads by itself.
      @Test func outputsDrawInlineAndOpenInTheApp() async throws {
        let recorder = OutputRecorder(image: Self.chartImage)
        var opened: [URL] = []
        let card = ResultPreviewCardView(item: .available(Self.outputsCard))
          .environment(\.resultOutputLoader, recorder)
          .environment(\.resultOutputPresenter, recorder)
          .environment(\.openURL, OpenURLAction { opened.append($0)
            return .handled
          })
        let (window, host) = Self.window(card.padding(12), size: NSSize(width: 620, height: 640))
        defer { window.orderOut(nil) }
        _ = try await Self.waitForText("Market scan", in: host)
        try await Self.until { recorder.answered == 1 }
        await Self.settle(host)
        #expect(recorder.loads == [.jobFile(jobId: "job-1", fileId: "blob-2", download: false)])

        let image = try #require(await Self.nodes(labelled: "View image chart.png", in: host).first)
        #expect(image.press())
        try await Self.until { recorder.previewed == ["chart.png"] }
        let document = try #require(await Self.nodes(labelled: "View document report.pdf", in: host).first)
        #expect(document.press())
        try await Self.until { recorder.previewed == ["chart.png", "report.pdf"] }
        let row = try #require(await Self.nodes(containing: "data.csv · text/csv · 300 bytes", in: host).first)
        #expect(row.press())
        try await Self.until { recorder.previewed == ["chart.png", "report.pdf", "data.csv"] }
        let download = try #require(await Self.nodes(labelled: "Download report.pdf", in: host).first)
        #expect(download.press())
        try await Self.until { recorder.saved == ["report.pdf"] }
        let play = try #require(await Self.nodes(labelled: "Play briefing.m4a", in: host).first)
        #expect(play.press())
        try await Self.until { recorder.loads.count == 5 }
        #expect(recorder.loads == [
          .jobFile(jobId: "job-1", fileId: "blob-2", download: false), .jobFile(jobId: "job-1", fileId: "blob-1", download: false),
          .jobFile(jobId: "job-1", fileId: "blob-4", download: false), .jobFile(jobId: "job-1", fileId: "blob-1", download: true),
          .jobFile(jobId: "job-1", fileId: "blob-3", download: false)
        ])
        // The loaded file plays in the native player, which replaces the Play button.
        try await Self.until { recorder.answered == 5 }
        await Self.settle(host)
        #expect(await Self.nodes(labelled: "Play briefing.m4a", in: host).isEmpty)
        #expect(opened.isEmpty, "\(opened)")
      }

      /// A Drive file's row opens its page on web (Core's `openHref` is a page, not bytes); its Download saves in the app.
      @Test func aDriveFilesPageStaysOnWebAndItsDownloadSaves() async throws {
        let recorder = OutputRecorder(image: Self.chartImage)
        var opened: [URL] = []
        let card = ResultPreviewCardView(item: .available(Self.driveFileCard))
          .environment(\.resultOutputLoader, recorder)
          .environment(\.resultOutputPresenter, recorder)
          .environment(\.openURL, OpenURLAction { opened.append($0)
            return .handled
          })
        let (window, host) = Self.window(card.padding(12), size: NSSize(width: 620, height: 300))
        defer { window.orderOut(nil) }
        _ = try await Self.waitForText("plan.docx", in: host)
        let row = try #require(await Self.nodes(containing: "plan.docx · application/vnd", in: host).first)
        #expect(row.press())
        await Self.settle(host)
        #expect(opened == [Self.web("/drive/files/\(Self.driveFile)?scope=me")])
        #expect(recorder.loads.isEmpty)
        let download = try #require(await Self.nodes(labelled: "Download plan.docx", in: host).first)
        #expect(download.press())
        try await Self.until { recorder.saved == ["plan.docx"] }
        #expect(recorder.loads == [.driveFile(id: Self.driveFile, scope: .personal, organizationId: nil, download: true)])
      }

      /// A load Core refuses (403/404/503) says so with Core's message instead of failing silently.
      @Test func aRefusedDownloadSaysSo() async throws {
        let recorder = OutputRecorder(image: Self.chartImage)
        recorder.failure = ChatServiceError.unprocessable(statusCode: 404, message: "Output unavailable")
        let card = ResultPreviewCardView(item: .available(Self.driveFileCard))
          .environment(\.resultOutputLoader, recorder)
          .environment(\.resultOutputPresenter, recorder)
        let (window, host) = Self.window(card.padding(12), size: NSSize(width: 620, height: 300))
        defer { window.orderOut(nil) }
        _ = try await Self.waitForText("plan.docx", in: host)
        let download = try #require(await Self.nodes(labelled: "Download plan.docx", in: host).first)
        #expect(download.press())
        try await Self.until { window.attachedSheet != nil }
        let sheet = try #require(window.attachedSheet)
        let texts = try await hostedTexts(in: #require(sheet.contentView))
        #expect(texts.contains("Could not download file") && texts.contains("Output unavailable"), "\(texts)")
        #expect(recorder.saved.isEmpty)
        window.endSheet(sheet)
      }

      /// Light beside dark: a job's image thumbnail, PDF tile, audio player, CSV row and Downloads, then a Studio
      /// generation's large image, each hosted over the window background.
      @Test func rendersTheProtectedOutputs() async throws {
        var columns: [[CGImage]] = []
        for dark in [false, true] {
          let recorder = OutputRecorder(image: Self.chartImage)
          let studioRecorder = OutputRecorder(image: Self.studioImage)
          let content = VStack(alignment: .leading, spacing: 12) {
            ResultPreviewCardView(item: .available(Self.outputsCard))
              .environment(\.resultOutputLoader, recorder)
            ResultPreviewCardView(item: .available(Self.studioCard))
              .environment(\.resultOutputLoader, studioRecorder)
          }
          .padding(12)
          try await columns.append([
            Self.draw(content, size: NSSize(width: 640, height: 1000), dark: dark, until: "A red fox at dawn") {} ready: {
              try await Self.until { recorder.loads.count == 1 && studioRecorder.loads.count == 1 }
              // The loaded files still decode off the main thread.
              try await Task.sleep(for: .milliseconds(600))
            }
          ])
        }
        let combined = try RoomHeaderTests.stitched(columns)
        try Attachment.record(#require(combined.representation(using: .png, properties: [:])), named: "soko-bot-result-outputs.png")
      }

      /// Polls until `condition` holds, failing after ten seconds.
      private static func until(_ condition: () -> Bool, sourceLocation: SourceLocation = #_sourceLocation) async throws {
        let deadline = ContinuousClock.now.advanced(by: .seconds(10))
        while !condition() {
          guard ContinuousClock.now < deadline else {
            Issue.record("the condition never held", sourceLocation: sourceLocation)
            return
          }
          try await Task.sleep(for: .milliseconds(25))
        }
      }

      // MARK: Helpers

      static func window(_ content: some View, size: NSSize) -> (NSWindow, NSView) {
        let host = NSHostingView(rootView: content.frame(width: size.width, height: size.height, alignment: .topLeading).background(.background)
          .environment(\.locale, Locale(identifier: "en_US")))
        let window = NSWindow(contentRect: NSRect(origin: .zero, size: size), styleMask: [.titled], backing: .buffered, defer: false)
        window.contentView = host
        window.orderFront(nil)
        return (window, host)
      }

      static func draw(_ content: some View, size: NSSize, dark: Bool, until text: String, poke: () -> Void = {},
                       ready: @MainActor () async throws -> Void = {}) async throws -> CGImage {
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
        try await ready()
        await settle(host)
        let bitmap = try #require(host.bitmapImageRepForCachingDisplay(in: host.bounds))
        host.cacheDisplay(in: host.bounds, to: bitmap)
        try CreateChannelGuidanceTests.expectWindowBackground(bitmap, dark: dark)
        return try #require(bitmap.cgImage)
      }

      static func settle(_ host: NSView) async {
        for _ in 0 ..< 8 {
          await Task.yield()
          host.layoutSubtreeIfNeeded()
          try? await Task.sleep(for: .milliseconds(25))
        }
      }

      static func waitForText(_ text: String, in host: NSView) async throws -> [String] {
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
      static func pressAll(_ label: String, in host: NSView) async -> Int {
        var pressed = 0
        for node in await nodes(labelled: label, in: host) where node.press() {
          pressed += 1
        }
        await settle(host)
        return pressed
      }

      static func nodes(labelled label: String, in host: NSView) async -> [ResultsNode] {
        await nodes(in: host) { $0 == label }
      }

      static func nodes(containing text: String, in host: NSView) async -> [ResultsNode] {
        await nodes(in: host) { $0 == text || $0.contains(text) }
      }

      /// Accessibility nodes, parents before children, whose label matches.
      static func nodes(in host: NSView, where matches: (String) -> Bool) async -> [ResultsNode] {
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

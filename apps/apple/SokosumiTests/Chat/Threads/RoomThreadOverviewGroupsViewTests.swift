#if os(macOS)
  import AppKit
  import CoreAPI
  import HTTPTypes
  import OpenAPIRuntime
  @testable import Sokosumi
  import SokosumiChat
  import SwiftUI
  import Testing
  import Vision

  extension NativeWindowTests {
    /// Row 24d: the real `RoomThreadOverviewView` groups its rows under Unread and Earlier. The test host
    /// builds no accessibility tree, so the text is read back with Vision (nil on the virtualized CI
    /// runner, where only the pixel checks run) and the tinted thread mark is found by its colour.
    @MainActor struct RoomThreadOverviewGroupsViewTests {
      @Test(arguments: ThreadOverviewGroupsFixture.allCases)
      func rendersTheGroups(fixture: ThreadOverviewGroupsFixture) async throws {
        let bitmap = try await Self.render(fixture)
        let scale = CGFloat(bitmap.pixelsWide) / Self.width
        // The leading thread mark is the only colour in the icon column: tinted when unread, grey when read.
        let tinted = Self.coloredPixels(in: bitmap, columns: 0 ..< Int(44 * scale))
        if fixture == .allRead {
          #expect(Self.coloredPixels(in: bitmap, columns: 0 ..< bitmap.pixelsWide).isEmpty,
                  "Nothing is tinted with nothing unread: no mark, no count on the heading, no time.")
        } else {
          #expect(tinted.count > 20, "An unread row leads with a tinted mark.")
        }

        guard let lines = try Self.recognizedText(in: bitmap) else { return }
        let texts = lines.map(\.text)
        func top(_ fragment: String) -> CGFloat? {
          lines.first { $0.text.contains(fragment) }.map { (1 - $0.box.maxY) * CGFloat(bitmap.pixelsHigh) }
        }
        let unreadHeading = try #require(top("Unread"), "\(texts)")
        // The Unread heading carries its count as a tinted pill beside the word.
        let headingBand = Int(max(0, unreadHeading - 4 * scale)) ..< Int(unreadHeading + 16 * scale)
        let pill = Self.coloredPixels(in: bitmap, columns: Int(44 * scale) ..< bitmap.pixelsWide).filter { headingBand.contains($0.y) }
        #expect(fixture == .allRead ? pill.isEmpty : pill.count > 10, "The count pill on the Unread heading: \(pill.count) pixels.")
        switch fixture {
        case .mixed:
          let earlier = try #require(top("Earlier"), "\(texts)")
          let release = try #require(top("Release checklist"), "\(texts)")
          let design = try #require(top("Design review notes"), "\(texts)")
          #expect(unreadHeading < release && release < earlier && earlier < design, "\(texts)")
          #expect(texts.contains { $0.contains("2 new") && $0.contains("Ada Lovelace") }, "\(texts)")
          #expect(texts.contains { $0.contains("Started by Ada Lovelace") && $0.contains("4 replies") }, "\(texts)")
          #expect(!texts.contains { $0.contains("All caught up") }, "\(texts)")
          #expect(tinted.allSatisfy { CGFloat($0.y) < earlier }, "Only the rows under Unread are tinted.")
        case .allRead:
          let caughtUp = try #require(top("All caught up."), "\(texts)")
          let earlier = try #require(top("Earlier"), "\(texts)")
          let release = try #require(top("Release checklist"), "\(texts)")
          #expect(unreadHeading < caughtUp && caughtUp < earlier && earlier < release, "\(texts)")
          #expect(texts.contains { $0.contains("1 reply") && !$0.contains("replies") }, "\(texts)")
          #expect(!texts.contains { $0.contains("new") }, "\(texts)")
        case .allUnread:
          #expect(!texts.contains { $0.contains("Earlier") || $0.contains("All caught up") }, "\(texts)")
          #expect(texts.contains { $0.contains("1 new") }, "\(texts)")
          #expect(!texts.contains { $0.contains("Started by") }, "\(texts)")
        }
      }

      /// A room with no threads keeps its empty state and draws no heading.
      @Test func anEmptyRoomShowsNoHeadings() async throws {
        let bitmap = try await Self.render(threads: [], dark: false, name: nil)
        guard let lines = try Self.recognizedText(in: bitmap) else { return }
        let texts = lines.map(\.text)
        #expect(texts.contains { $0.contains("No threads yet.") }, "\(texts)")
        #expect(!texts.contains { $0.contains("Unread") || $0.contains("Earlier") || $0.contains("caught up") }, "\(texts)")
      }

      // MARK: Helpers

      private static let width: CGFloat = 280

      private static func render(_ fixture: ThreadOverviewGroupsFixture) async throws -> NSBitmapImageRep {
        try await render(threads: fixture.threads, dark: false, name: "thread-overview-groups-\(fixture.rawValue).png")
      }

      private static func render(threads: [ThreadOverviewFixtureRow], dark: Bool, name: String?) async throws -> NSBitmapImageRep {
        let transport = try GroupsOverviewTransport(body: threadOverviewPageBody(threads, nextCursor: nil))
        let overview = RoomThreadOverview()
        try await overview.load(client: Client.connecting(to: #require(URL(string: "https://example.com")), transport: transport), roomId: "room", organizationSlug: nil)
        try #require(overview.items.count == threads.count)
        let host = NSHostingView(rootView: RoomThreadOverviewView(overview: overview, open: { _ in }, older: {}, markAllRead: {}, retry: {}, close: {})
          .frame(width: width, height: 330).background(.background)
          .environment(\.colorScheme, dark ? .dark : .light))
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: width, height: 330), styleMask: [.titled], backing: .buffered, defer: false)
        defer { window.orderOut(nil) }
        window.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        window.contentView = host
        window.orderFront(nil)
        for _ in 0 ..< 10 {
          host.layoutSubtreeIfNeeded()
          try await Task.sleep(for: .milliseconds(20))
        }
        let bitmap = try fittedBitmap(of: host, in: window)
        if let name {
          try Attachment.record(#require(bitmap.representation(using: .png, properties: [:])), named: name)
        }
        return bitmap
      }

      /// Pixels in `columns` whose channels differ enough to be a colour (origin top left).
      static func coloredPixels(in bitmap: NSBitmapImageRep, columns: Range<Int>) -> [(x: Int, y: Int)] {
        var result: [(x: Int, y: Int)] = []
        for row in 0 ..< bitmap.pixelsHigh {
          for column in columns.clamped(to: 0 ..< bitmap.pixelsWide) {
            guard let color = bitmap.colorAt(x: column, y: row)?.usingColorSpace(.sRGB) else { continue }
            let channels = [color.redComponent, color.greenComponent, color.blueComponent]
            if let high = channels.max(), let low = channels.min(), high - low > 0.12 {
              result.append((column, row))
            }
          }
        }
        return result
      }

      /// Vision's lines with their boxes, or nil where Vision cannot run at all (the virtualized CI runner).
      static func recognizedText(in bitmap: NSBitmapImageRep) throws -> [(text: String, box: CGRect)]? {
        let image = try #require(bitmap.cgImage)
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.recognitionLanguages = ["en-US"]
        request.usesLanguageCorrection = false
        do {
          try VNImageRequestHandler(cgImage: image).perform([request])
        } catch {
          print("OCR unavailable (accurate): \(error)")
          return nil
        }
        return (request.results ?? []).compactMap { observation in
          observation.topCandidates(1).first.map { (text: $0.string, box: observation.boundingBox) }
        }
      }
    }
  }

  /// The three overview states row 24d renders, each in Core's order: unread first.
  enum ThreadOverviewGroupsFixture: String, CaseIterable, CustomTestStringConvertible {
    case mixed, allRead = "all-read", allUnread = "all-unread"

    var testDescription: String {
      rawValue
    }

    var threads: [ThreadOverviewFixtureRow] {
      switch self {
      case .mixed: [.init(preview: "Release checklist", replies: 5, unread: 2), .init(preview: "Design review notes", replies: 4, unread: 0)]
      case .allRead: [.init(preview: "Release checklist", replies: 4, unread: 0), .init(preview: "Design review notes", replies: 1, unread: 0)]
      case .allUnread: [.init(preview: "Release checklist", replies: 5, unread: 2), .init(preview: "Design review notes", replies: 3, unread: 1)]
      }
    }
  }

  struct ThreadOverviewFixtureRow {
    let preview: String
    let replies: Int
    let unread: Int
  }

  /// Core's `GET …/threads` page for `threads`, started by Ada Lovelace at a fixed time, in the given order.
  func threadOverviewPageBody(_ threads: [ThreadOverviewFixtureRow], nextCursor: String?) throws -> String {
    let sender = Components.Schemas.ChatRoomUserParticipant(id: "user", name: "Ada Lovelace", email: "ada@example.com", presence: .online)
    let reference = Date(timeIntervalSince1970: 1_790_000_000)
    let items = threads.map { row in
      var parent = chatRoomMessage(from: OutboundShell(clientTurnId: row.preview, roomId: "room", content: row.preview, createdAt: reference, sender: sender))
      parent.id = row.preview
      return Components.Schemas.ChatRoomThread(parentMessage: parent, replyCount: row.replies, lastReplyAt: reference,
                                               unreadReplyCount: row.unread, hasLooked: true)
    }
    let encoder = JSONEncoder()
    encoder.dateEncodingStrategy = .custom { date, encoder in
      let formatter = ISO8601DateFormatter()
      formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
      var value = encoder.singleValueContainer()
      try value.encode(formatter.string(from: date))
    }
    let rows = try #require(String(bytes: encoder.encode(items), encoding: .utf8))
    let cursor = nextCursor.map { "\"\($0)\"" } ?? "null"
    return "{\"data\":\(rows),\"meta\":{\"timestamp\":\"2026-09-23T12:00:00.000Z\",\"requestId\":\"fixture\",\"pagination\":{\"cursor\":null,\"limit\":50,\"total\":\(items.count),\"nextCursor\":\(cursor)}}}"
  }

  private nonisolated struct GroupsOverviewTransport: ClientTransport {
    let body: String
    func send(_: HTTPRequest, body _: HTTPBody?, baseURL _: URL, operationID _: String) async throws -> (HTTPResponse, HTTPBody?) {
      (HTTPResponse(status: .ok), HTTPBody(body))
    }
  }
#endif

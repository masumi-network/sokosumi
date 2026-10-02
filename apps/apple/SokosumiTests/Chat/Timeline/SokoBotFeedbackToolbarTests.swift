#if os(macOS)
  import AppKit
  import CoreAPI
  import OpenAPIRuntime
  @testable import Sokosumi
  import SokosumiAuth
  import SokosumiChat
  import SokosumiWorkspace
  import SwiftUI
  import Testing

  /// The ratings a row sent.
  @MainActor private final class SokoBotRatings {
    var values: [Bool] = []
  }

  /// A hovered row's drawing and its two thumbs' centres, in points.
  private struct HoveredToolbar {
    let bitmap: NSBitmapImageRep
    let useful: CGPoint
    let notUseful: CGPoint
  }

  extension NativeWindowTests {
    /// Row 38b: web #5554 moved the Soko Bot turn's useful / not useful thumbs out of the footer and into the
    /// message's hover toolbar, at its head; a rated thumb stays filled and both lock, and the footer keeps only
    /// approvals and Tasks. The test host builds no accessibility tree, so the tests find the thumbs by pixels.
    @MainActor struct SokoBotFeedbackToolbarTests {
      /// Room above the row for the upper half of the hover toolbar.
      private static let top: CGFloat = 24
      /// The row's content starts under its own 8 pt sender-group padding; the toolbar is centred on that edge.
      private static let contentTop = top + 8
      private static let width: CGFloat = 560

      private static func reply(_ content: String, soko: [String: any Sendable]?) throws -> Components.Schemas.ChatRoomMessage {
        try .init(
          id: "reply_\(content.count)",
          roomId: "room_1",
          parentMessageId: nil,
          content: content,
          createdAt: Date(timeIntervalSince1970: 1_790_251_200),
          deletedAt: nil,
          editedAt: nil,
          sender: .case3(.init(_type: .sokoBot, sokoBot: .init(id: "bot_1", name: "Soko", caption: "Ada's personal assistant",
                                                               image: nil, avatarSeed: "orb:user_2", ownerUserId: "user_2", presence: .online))),
          mentions: [],
          reactions: [],
          threadReplyCount: 0,
          threadLastReplyAt: nil,
          metadata: soko.map { record in
            try .init(additionalProperties: ["mention_id": OpenAPIValueContainer(unvalidatedValue: "mention_1"),
                                             "soko_bot": OpenAPIValueContainer(unvalidatedValue: record)])
          },
          quote: nil,
          membership: nil,
          unfurls: nil
        )
      }

      private static let plan = "Your Tuesday is clear after 3 pm, so I moved both reviews to Wednesday morning."

      /// The row as the room passes it, in a window: Reply and Quote, plus the thumbs when the turn has them.
      private static func host(_ message: Components.Schemas.ChatRoomMessage, feedback: SokoBotFeedback?, ratings: SokoBotRatings,
                               dark: Bool = false) async throws -> (NSHostingView<AnyView>, NSWindow) {
        let row = MessageRowView(message: message, isContinuation: false, outbound: nil, onRetry: nil, onRemove: nil,
                                 onReply: {}, onQuote: {},
                                 sokoBotFeedback: feedback,
                                 onSokoBotFeedback: { ratings.values.append($0) },
                                 horizontalInset: 12)
        let host = NSHostingView(rootView: AnyView(row
            .padding(.top, top)
            .padding(.bottom, 8)
            .frame(width: width, alignment: .topLeading)
            .background(.background)
            .environmentObject(WorkspaceState()).environmentObject(AuthState())
            .environment(\.colorScheme, dark ? .dark : .light)
            .environment(\.locale, Locale(identifier: "en_US"))))
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: width, height: 160), styleMask: [.titled], backing: .buffered, defer: false)
        window.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        window.contentView = host
        window.makeKeyAndOrderFront(nil)
        for _ in 0 ..< 8 {
          host.layoutSubtreeIfNeeded()
          try await Task.sleep(for: .milliseconds(20))
        }
        window.setContentSize(host.fittingSize)
        host.layoutSubtreeIfNeeded()
        return (host, window)
      }

      private static func draw(_ host: NSView) throws -> NSBitmapImageRep {
        let bitmap = try #require(host.bitmapImageRepForCachingDisplay(in: host.bounds))
        host.cacheDisplay(in: host.bounds, to: bitmap)
        return bitmap
      }

      private static func luminance(_ bitmap: NSBitmapImageRep, _ column: Int, _ row: Int) -> CGFloat {
        guard let color = bitmap.colorAt(x: column, y: row)?.usingColorSpace(.deviceRGB) else { return 0 }
        return 0.2126 * color.redComponent + 0.7152 * color.greenComponent + 0.0722 * color.blueComponent
      }

      /// The hovered toolbar's leading edge, in points: the first column above the row that the hover changed.
      private static func toolbarMinX(hovered: NSBitmapImageRep, plain: NSBitmapImageRep) throws -> CGFloat {
        let scale = CGFloat(hovered.pixelsWide) / width
        let rows = Int((top - 6) * scale) ..< Int((contentTop - 2) * scale)
        let column = (0 ..< hovered.pixelsWide).first { column in
          rows.contains { abs(luminance(hovered, column, $0) - luminance(plain, column, $0)) > 0.06 }
        }
        return try CGFloat(#require(column, "The hover drew a toolbar above the row")) / scale
      }

      /// Where the two thumbs sit: the toolbar's first two compact controls (a 16 pt icon with 8 pt either side)
      /// inside its 3 pt padding, 2 pt apart.
      private static func thumbCentres(toolbarMinX: CGFloat) -> (useful: CGPoint, notUseful: CGPoint) {
        (CGPoint(x: toolbarMinX + 3 + 16, y: contentTop), CGPoint(x: toolbarMinX + 3 + 32 + 2 + 16, y: contentTop))
      }

      /// An icon in the 20 pt square around `centre`, against the square's median (the toolbar behind it): how many
      /// pixels it covers and how far its strongest pixel stands out.
      private static func ink(around centre: CGPoint, in bitmap: NSBitmapImageRep) -> (coverage: Int, peak: CGFloat) {
        let scale = CGFloat(bitmap.pixelsWide) / width
        let span = Int(10 * scale)
        let (column, row) = (Int(centre.x * scale), Int(centre.y * scale))
        let values = (-span ..< span).flatMap { down in (-span ..< span).map { across in luminance(bitmap, column + across, row + down) } }
        let median = values.sorted()[values.count / 2]
        let deviations = values.map { abs($0 - median) }
        return (deviations.count { $0 > 0.03 }, deviations.max() ?? 0)
      }

      /// Hovers the row and returns the drawing with its toolbar and the thumbs' centres.
      private static func hovered(_ host: NSView, in window: NSWindow) async throws -> HoveredToolbar {
        let plain = try draw(host)
        try await hover(NSPoint(x: width / 2, y: contentTop + 20), in: host, window: window)
        let shown = try draw(host)
        let thumbs = try thumbCentres(toolbarMinX: toolbarMinX(hovered: shown, plain: plain))
        return HoveredToolbar(bitmap: shown, useful: thumbs.useful, notUseful: thumbs.notUseful)
      }

      /// Web `hasSokoBotMessageFooter`: a reply with only its turn leaves no line under the message; Tasks still do.
      @Test func theFooterLeavesNoLineWithoutApprovalsOrTasks() async throws {
        let ratings = SokoBotRatings()
        func height(_ soko: [String: any Sendable]?) async throws -> CGFloat {
          let (host, window) = try await Self.host(Self.reply(Self.plan, soko: soko), feedback: nil, ratings: ratings)
          defer { window.orderOut(nil) }
          return host.fittingSize.height
        }
        let plain = try await height(nil)
        let turnOnly = try await height(["turn_id": "turn_1"])
        let withTask = try await height(["turn_id": "turn_1", "task_ids": ["task_1"] as [String]])
        #expect(turnOnly == plain, "No footer line for the turn alone: \(turnOnly) vs \(plain)")
        #expect(withTask > plain, "The Task chip keeps its footer: \(withTask) vs \(plain)")
      }

      /// The thumbs lead the hover toolbar; a click rates the turn with that answer.
      @Test(arguments: [true, false])
      func theThumbsLeadTheHoverToolbarAndRate(useful: Bool) async throws {
        let ratings = SokoBotRatings()
        let message = try Self.reply(Self.plan, soko: ["turn_id": "turn_1"])
        let (host, window) = try await Self.host(message, feedback: SokoBotFeedback(turnId: "turn_1"), ratings: ratings)
        defer { window.orderOut(nil) }
        let shown = try await Self.hovered(host, in: window)
        let scale = CGFloat(shown.bitmap.pixelsWide) / Self.width
        let target = useful ? shown.useful : shown.notUseful
        clickPixel(CGPoint(x: target.x * scale, y: target.y * scale), of: shown.bitmap, drawnFrom: host, in: window)
        for _ in 0 ..< 50 where ratings.values.isEmpty {
          try await Task.sleep(for: .milliseconds(20))
        }
        #expect(ratings.values == [useful])
      }

      /// Rated: the chosen thumb is filled, both dim and neither takes a click.
      @Test func aRatedThumbIsFilledAndBothLock() async throws {
        let ratings = SokoBotRatings()
        let message = try Self.reply(Self.plan, soko: ["turn_id": "turn_1"])
        let (idleHost, idleWindow) = try await Self.host(message, feedback: SokoBotFeedback(turnId: "turn_1"), ratings: ratings)
        let idle = try await Self.hovered(idleHost, in: idleWindow)
        idleWindow.orderOut(nil)
        let (host, window) = try await Self.host(message, feedback: SokoBotFeedback(turnId: "turn_1", rating: true), ratings: ratings)
        defer { window.orderOut(nil) }
        let rated = try await Self.hovered(host, in: window)
        #expect(abs(rated.useful.x - idle.useful.x) < 1, "The thumbs stay in place: \(rated.useful) vs \(idle.useful)")
        let (idleUpInk, ratedUpInk) = (Self.ink(around: idle.useful, in: idle.bitmap), Self.ink(around: rated.useful, in: rated.bitmap))
        let (idleDownInk, ratedDownInk) = (Self.ink(around: idle.notUseful, in: idle.bitmap), Self.ink(around: rated.notUseful, in: rated.bitmap))
        #expect(idleUpInk.coverage > 0 && idleDownInk.coverage > 0, "Both thumbs draw before a rating: \(idleUpInk), \(idleDownInk)")
        #expect(Double(ratedUpInk.coverage) > Double(idleUpInk.coverage) * 1.2, "The chosen thumb fills: \(ratedUpInk) vs \(idleUpInk)")
        #expect(ratedUpInk.peak < idleUpInk.peak * 0.8, "The chosen thumb dims too: \(ratedUpInk) vs \(idleUpInk)")
        #expect(ratedDownInk.peak < idleDownInk.peak * 0.8, "The other thumb dims: \(ratedDownInk) vs \(idleDownInk)")
        let scale = CGFloat(rated.bitmap.pixelsWide) / Self.width
        for thumb in [rated.useful, rated.notUseful] {
          clickPixel(CGPoint(x: thumb.x * scale, y: thumb.y * scale), of: rated.bitmap, drawnFrom: host, in: window)
        }
        try await Task.sleep(for: .milliseconds(200))
        #expect(ratings.values.isEmpty, "A locked thumb ignores clicks: \(ratings.values)")
      }

      /// The recorded picture: the hovered toolbar on an unrated reply and on a rated one with a Task, light beside
      /// dark, each over the window background.
      @Test func rendersTheToolbarThumbsInLightAndDark() async throws {
        var columns: [[CGImage]] = [[], []]
        let rows: [(Components.Schemas.ChatRoomMessage, SokoBotFeedback)] = try [
          (Self.reply(Self.plan, soko: ["turn_id": "turn_1"]), SokoBotFeedback(turnId: "turn_1")),
          (Self.reply("I created the Task and assigned it to Elena.", soko: ["turn_id": "turn_2", "task_ids": ["task_1"] as [String]]),
           SokoBotFeedback(turnId: "turn_2", rating: true))
        ]
        for (column, dark) in [false, true].enumerated() {
          for (message, feedback) in rows {
            let (host, window) = try await Self.host(message, feedback: feedback, ratings: SokoBotRatings(), dark: dark)
            defer { window.orderOut(nil) }
            let shown = try await Self.hovered(host, in: window).bitmap
            let corner = try #require(shown.colorAt(x: 1, y: shown.pixelsHigh - 2)?.usingColorSpace(.deviceRGB))
            #expect(corner.alphaComponent == 1, "Hosted over the window background: alpha \(corner.alphaComponent)")
            try columns[column].append(#require(shown.cgImage))
          }
        }
        let combined = try RoomHeaderTests.stitched(columns)
        try Attachment.record(#require(combined.representation(using: .png, properties: [:])), named: "soko-bot-feedback-toolbar.png")
      }
    }
  }
#endif

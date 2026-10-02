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

  extension NativeWindowTests {
    /// Row 38c: web #5536 puts a quiet line with an icon above a message the Soko Bot sent on its own, saying what
    /// triggered it; a reply in chat carries no `source` and gets none.
    @MainActor struct SokoBotSourceLabelTests {
      private static let width: CGFloat = 560
      /// Where the text column starts: the 12 pt inset, the 28 pt avatar and the 14 pt gap.
      private static let textMinX: CGFloat = 12 + 28 + 14
      private static let text = "Two Tasks are past their due date, so I nudged Elena."

      private static func message(_ id: String, soko: [String: any Sendable]?, content: String = text,
                                  deleted: Bool = false) throws -> Components.Schemas.ChatRoomMessage {
        let createdAt = Date(timeIntervalSince1970: 1_790_251_200)
        return try .init(
          id: id,
          roomId: "room_1",
          parentMessageId: nil,
          content: deleted ? "" : content,
          createdAt: createdAt,
          deletedAt: deleted ? createdAt : nil,
          editedAt: nil,
          sender: .case3(.init(_type: .sokoBot, sokoBot: .init(id: "bot_1", name: "Soko", caption: "Ada's personal assistant",
                                                               image: nil, avatarSeed: "orb:user_2", ownerUserId: "user_2", presence: .online))),
          mentions: [],
          reactions: [],
          threadReplyCount: 0,
          threadLastReplyAt: nil,
          metadata: soko.map { try .init(additionalProperties: ["soko_bot": OpenAPIValueContainer(unvalidatedValue: $0)]) },
          quote: nil,
          membership: nil,
          unfurls: nil
        )
      }

      private static func row(_ message: Components.Schemas.ChatRoomMessage, continuation: Bool = false) -> MessageRowView {
        MessageRowView(message: message, isContinuation: continuation, outbound: nil, onRetry: nil, onRemove: nil, horizontalInset: 12)
      }

      /// The rows in a key window over its background, as the transcript draws them.
      private static func host(_ content: some View, dark: Bool = false) async throws -> (NSHostingView<AnyView>, NSWindow) {
        let host = NSHostingView(rootView: AnyView(content
            .padding(.vertical, 8)
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

      /// The text column's lines of ink, top to bottom, in points: each run of pixel rows that holds anything but background.
      private static func lines(_ bitmap: NSBitmapImageRep) -> [ClosedRange<CGFloat>] {
        let scale = CGFloat(bitmap.pixelsWide) / width
        let background = luminance(bitmap, bitmap.pixelsWide - 2, 1)
        let columns = Int(textMinX * scale) ..< bitmap.pixelsWide - Int(12 * scale)
        var lines: [ClosedRange<Int>] = []
        for row in 0 ..< bitmap.pixelsHigh where columns.contains(where: { abs(luminance(bitmap, $0, row) - background) > 0.08 }) {
          if let last = lines.last, last.upperBound == row - 1 {
            lines[lines.count - 1] = last.lowerBound ... row
          } else {
            lines.append(row ... row)
          }
        }
        return lines.map { CGFloat($0.lowerBound) / scale ... CGFloat($0.upperBound + 1) / scale }
      }

      @Test(arguments: ["en", "de", "es"])
      func sourceStringsAreLocalized(locale: String) throws {
        let path = try #require(Bundle.main.path(forResource: locale, ofType: "lproj"))
        let bundle = try #require(Bundle(path: path))
        // Web `App.Chat.SokoBot.source` in en, de and es.
        let expected = [
          "en": ["From your inbox", "Daily stand-up", "Weekly wrap", "Scheduled: Monday check-in", "Task update"],
          "de": ["Aus deinem Posteingang", "Tägliches Stand-up", "Wochenrückblick", "Geplant: Monday check-in", "Task-Update"],
          "es": ["De tu bandeja de entrada", "Stand-up diario", "Resumen semanal", "Programado: Monday check-in", "Actualización de tarea"]
        ]
        func localized(_ key: String) -> String {
          bundle.localizedString(forKey: key, value: nil, table: sokoBotSourceTable)
        }
        let strings = ["From your inbox", "Daily stand-up", "Weekly wrap"].map(localized)
          + [String(format: localized("Scheduled: %@"), "Monday check-in"), localized("Task update")]
        #expect(strings == expected[locale])
      }

      /// Web's lucide icons: Mail, CalendarClock for both system schedules, Clock for another, ListChecks for a Task update.
      @Test func eachLabelHasTheSymbolOfWebsIcon() {
        let symbols: [(SokoBotSourceLabel, String)] = [
          (.inbox, "envelope"), (.standup, "calendar.badge.clock"), (.weeklyWrap, "calendar.badge.clock"),
          (.scheduled(name: "Monday check-in"), "clock"), (.taskUpdate, "checklist")
        ]
        for (label, symbol) in symbols {
          #expect(label.systemImage == symbol)
          #expect(NSImage(systemSymbolName: label.systemImage, accessibilityDescription: nil) != nil, "\(symbol) exists")
        }
      }

      /// The line sits under the sender and time and above the text, in a header row and a continuation alike, and a
      /// reply without a `source` or a deleted message leaves none.
      @Test(arguments: [false, true])
      func theLabelTakesALineBetweenTheHeaderAndTheText(continuation: Bool) async throws {
        func drawn(_ soko: [String: any Sendable], deleted: Bool = false) async throws -> NSBitmapImageRep {
          let (host, window) = try await Self.host(Self.row(Self.message("m", soko: soko, deleted: deleted), continuation: continuation))
          defer { window.orderOut(nil) }
          return try Self.draw(host)
        }
        let reply = try await Self.lines(drawn(["turn_id": "turn_1"]))
        let inbox = try await Self.lines(drawn(["turn_id": "turn_1", "source": "INGEST"]))
        #expect(inbox.count == reply.count + 1, "One more line: \(inbox) vs \(reply)")
        guard inbox.count == reply.count + 1, let replyText = reply.last, let labelText = inbox.last else { return }
        // The text is the same last line, pushed down; the label is the line right above it, smaller than the text.
        let label = inbox[inbox.count - 2]
        #expect(abs(labelText.upperBound - labelText.lowerBound - (replyText.upperBound - replyText.lowerBound)) < 1)
        #expect(label.upperBound - label.lowerBound < replyText.upperBound - replyText.lowerBound, "\(label) is a caption")
        #expect(labelText.lowerBound - replyText.lowerBound > 10, "The text moved down: \(labelText) vs \(replyText)")
        if !continuation {
          #expect(abs(inbox[0].lowerBound - reply[0].lowerBound) < 1, "The header stays on top: \(inbox[0]) vs \(reply[0])")
        }
        let deleted = try await Self.lines(drawn(["turn_id": "turn_1", "source": "INGEST"], deleted: true))
        let deletedReply = try await Self.lines(drawn(["turn_id": "turn_1"], deleted: true))
        #expect(deleted.count == deletedReply.count, "A deleted message has no label: \(deleted) vs \(deletedReply)")
      }

      /// The recorded picture: each kind of label, then a chat reply with none, light beside dark, over the window background.
      @Test func rendersEachLabelInLightAndDark() async throws {
        let rows = try [
          Self.message("inbox", soko: ["turn_id": "turn_1", "source": "INGEST"],
                       content: "Ana asked to move Thursday's review. I drafted a reply."),
          Self.message("standup", soko: ["turn_id": "turn_2", "source": "SCHEDULE", "schedule_name": "Daily stand-up", "schedule_key": "standup"],
                       content: "Good morning. Two Tasks are overdue, so I nudged Elena."),
          Self.message("wrap", soko: ["turn_id": "turn_3", "source": "SCHEDULE", "schedule_name": "Weekly wrap", "schedule_key": "weekly-wrap"],
                       content: "You closed nine Tasks this week. My notes are up to date."),
          // A schedule the owner made: Core writes its name and a null key.
          Self.message("custom", soko: ["turn_id": "turn_4", "source": "SCHEDULE", "schedule_name": "Monday check-in"],
                       content: "Your Monday is clear after 3 pm."),
          Self.message("event", soko: ["turn_id": "turn_5", "source": "EVENT"],
                       content: "Elena finished the release notes and wants a review."),
          // A reply in chat: Core writes no source.
          Self.message("reply", soko: ["turn_id": "turn_6"], content: "Done, both reviews are on Wednesday morning.")
        ]
        var columns: [[CGImage]] = [[], []]
        for (column, dark) in [false, true].enumerated() {
          let (host, window) = try await Self.host(VStack(alignment: .leading, spacing: 0) {
            ForEach(rows, id: \.id) { Self.row($0) }
          }, dark: dark)
          defer { window.orderOut(nil) }
          let shown = try Self.draw(host)
          let corner = try #require(shown.colorAt(x: 1, y: shown.pixelsHigh - 2)?.usingColorSpace(.deviceRGB))
          #expect(corner.alphaComponent == 1, "Hosted over the window background: alpha \(corner.alphaComponent)")
          #expect(Self.lines(shown).count == rows.count * 2 + 5, "Header and text for six rows plus five labels: \(Self.lines(shown).count)")
          try columns[column].append(#require(shown.cgImage))
        }
        let combined = try RoomHeaderTests.stitched(columns)
        try Attachment.record(#require(combined.representation(using: .png, properties: [:])), named: "soko-bot-source-label.png")
      }
    }
  }
#endif

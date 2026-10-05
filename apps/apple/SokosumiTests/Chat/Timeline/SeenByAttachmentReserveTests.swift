#if os(macOS)
  import AppKit
  import CoreAPI
  @testable import Sokosumi
  import SokosumiAuth
  import SokosumiChat
  import SokosumiWorkspace
  import SwiftUI
  import Testing

  /// The newest row of the open room, its Seen by read through the real receipts and live marks, as
  /// `RoomTimelineView` reads `WorkspaceState.roomReadReceipts`.
  private struct SeenByReserveNewestRow: View {
    @ObservedObject var marks: RoomReadMarks
    let room: Components.Schemas.ChatRoom
    let message: Components.Schemas.ChatRoomMessage

    var body: some View {
      let receipts = RoomReadReceipts(room: room, currentUserId: "user_ben", liveReads: marks.roomId == room.id ? marks.marks : [:])
      MessageRowView(message: message, isContinuation: false, outbound: nil, onRetry: nil, onRemove: nil, horizontalInset: 12,
                     newestEndsInAttachment: MessageMarkdown.endsWithAttachmentRun(message.content),
                     seenBy: receipts.seenBy(messageId: message.id, createdAt: message.createdAt, newestMessageId: message.id))
    }
  }

  private struct SeenByReserveHost {
    let host: NSHostingView<AnyView>
    let window: NSWindow
    let marks: RoomReadMarks
  }

  extension NativeWindowTests {
    /// Row 31b3 (web #5611): the room's read state lands after the newest row has laid out — a live
    /// `chat_room_read` through `RoomReadMarks`, as `WorkspaceState.roomReadReceipts` reads it. When the newest
    /// message ends in attachments the row keeps the faces' corner from its first layout, so their arrival moves
    /// nothing and they never cover the picture or a tile. A body ending in text keeps row 31b1's reserve.
    @MainActor struct SeenByAttachmentReserveTests {
      private static let base = Date(timeIntervalSince1970: 1_790_251_200)
      private static let width: CGFloat = 520
      /// The faces' band: 16 pt faces 4 pt above the row's bottom edge, and the 1 pt ring that parts them.
      private static let facesBand: CGFloat = 4 + SeenByFaces.faceDiameter + 1

      private static func member(_ name: String) -> Components.Schemas.ChatRoomUserParticipant {
        .init(id: "user_\(name.lowercased())", name: name, email: "\(name.lowercased())@example.com", image: nil,
              presence: .offline, lastReadAt: nil)
      }

      /// Nobody has read the room yet in its payload; the faces arrive as live marks.
      private static let room = Components.Schemas.ChatRoom(
        id: "room_1", name: "Launch", kind: .direct, isSelfDirect: false, isGroupDirect: true, isReadOnly: false,
        createdByUserId: "user_ben", createdAt: base, updatedAt: base, unreadCount: 0, unreadMentionCount: 0, markedUnread: false,
        myAccess: .init(value1: .member, value2: "member"), userMembers: [member("Ben"), member("Grace"), member("Linus")],
        formerUserMembers: [], coworkerMembers: [], sokoBotMembers: []
      )

      private static func message(_ content: String, reacted: Bool = false) -> Components.Schemas.ChatRoomMessage {
        var message = chatRoomMessage(from: .init(
          clientTurnId: "newest", roomId: room.id, content: content, createdAt: base,
          sender: .init(id: "user_ben", name: "Ben", email: "ben@example.com", presence: .offline)
        ))
        message.id = "newest"
        message.metadata = nil
        if reacted {
          message.reactions = [.init(emoji: "👍", count: 1, reactedByCurrentUser: false, reactors: [])]
        }
        return message
      }

      private nonisolated static func picture(_ name: String, shape: String = "landscape") -> String {
        "[\(name).svg](https://scroll-fixture.invalid/seen-by-reserve/\(name).svg?format=svg&shape=\(shape))"
      }

      /// A picture that spans the 454 pt column at this width, so a narrower column would shrink it.
      private nonisolated static let pictureSource = "Here is the launch banner.\n\n" + picture("banner")
      /// Five pictures and a document: 424 pt of tiles that fit the column, but not once it gives up the faces' width.
      private nonisolated static let tilesSource = (0 ..< 5).map { picture("tile\($0)", shape: "portrait") }.joined(separator: " ")
        + " [notes.pdf](https://example.com/notes.pdf)"

      private static func host(_ view: some View, marks: RoomReadMarks, dark: Bool) -> SeenByReserveHost {
        let host = NSHostingView(rootView: AnyView(view
            .frame(width: width, alignment: .leading)
            .background(.background)
            .environmentObject(WorkspaceState()).environmentObject(AuthState())
            .environment(\.colorScheme, dark ? .dark : .light)
            .environment(\.locale, Locale(identifier: "en_US"))))
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: width, height: 600), styleMask: [.titled], backing: .buffered, defer: false)
        window.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        window.contentView = host
        window.orderFront(nil)
        return SeenByReserveHost(host: host, window: window, marks: marks)
      }

      private static func newestRow(_ message: Components.Schemas.ChatRoomMessage, dark: Bool = false) -> SeenByReserveHost {
        let marks = RoomReadMarks()
        marks.open(roomId: room.id)
        return host(SeenByReserveNewestRow(marks: marks, room: room, message: message), marks: marks, dark: dark)
      }

      /// Draws until the pictures (when the body has any) have loaded and five captures in a row agree.
      private static func settled(_ hosted: SeenByReserveHost, pictures: Bool = true) async throws -> NSBitmapImageRep {
        var previous = try fittedBitmap(of: hosted.host, in: hosted.window)
        var steady = 0
        for _ in 0 ..< 400 where steady < 5 {
          try await Task.sleep(for: .milliseconds(20))
          let current = try fittedBitmap(of: hosted.host, in: hosted.window)
          let same = current.pixelsHigh == previous.pixelsHigh && current.tiffRepresentation == previous.tiffRepresentation
          steady = same && (!pictures || pictureBottom(current) > 0) ? steady + 1 : 0
          previous = current
        }
        return previous
      }

      /// Two members read the room after the row has drawn.
      private static func readersArrive(_ hosted: SeenByReserveHost) {
        for name in ["user_grace", "user_linus"] {
          hosted.marks.apply(ChatRoomReadEvent(roomId: room.id, userId: name, lastReadAt: base.addingTimeInterval(60)))
        }
      }

      /// The fixture pictures' green (`ScrollMediaProtocol`).
      private static func isGreen(_ bitmap: NSBitmapImageRep, column: Int, row: Int) -> Bool {
        var pixel = [Int](repeating: 0, count: max(bitmap.samplesPerPixel, 4))
        bitmap.getPixel(&pixel, atX: column, y: row)
        let top = Double((1 << bitmap.bitsPerSample) - 1)
        return Double(pixel[0]) / top < 0.6 && Double(pixel[1]) / top > 0.7 && Double(pixel[2]) / top < 0.35
      }

      /// The lowest pixel row (from the top) where a picture draws; -1 when none does.
      private static func pictureBottom(_ bitmap: NSBitmapImageRep) -> Int {
        for row in stride(from: bitmap.pixelsHigh - 1, through: 0, by: -1) {
          for column in stride(from: 0, to: bitmap.pixelsWide, by: 2) where isGreen(bitmap, column: column, row: row) {
            return row
          }
        }
        return -1
      }

      private static func differingBytes(_ lhs: NSBitmapImageRep, _ rhs: NSBitmapImageRep, rows: Range<Int>, columns: Range<Int>) throws -> Int {
        let left = try #require(lhs.bitmapData), right = try #require(rhs.bitmapData)
        try #require(lhs.bytesPerRow == rhs.bytesPerRow && lhs.pixelsHigh == rhs.pixelsHigh, "Same size: \(lhs.size) vs \(rhs.size)")
        let bytesPerPixel = lhs.bitsPerPixel / 8
        var count = 0
        for row in rows {
          for byte in (columns.lowerBound * bytesPerPixel) ..< (columns.upperBound * bytesPerPixel)
            where left[row * lhs.bytesPerRow + byte] != right[row * lhs.bytesPerRow + byte] {
            count += 1
          }
        }
        return count
      }

      /// A picture or a run of tiles ends the newest message: the faces arrive in the corner kept under it, and
      /// the row is drawn exactly as before above their band — same height, same picture, same tiles.
      @Test(arguments: [pictureSource, tilesSource])
      func facesArrivingUnderAttachmentsMoveNothing(source: String) async throws {
        URLProtocol.registerClass(ScrollMediaProtocol.self)
        defer { URLProtocol.unregisterClass(ScrollMediaProtocol.self) }
        let hosted = Self.newestRow(Self.message(source))
        defer { hosted.window.orderOut(nil) }
        let before = try await Self.settled(hosted)
        try #require(Self.pictureBottom(before) > 0, "The pictures loaded")
        Self.readersArrive(hosted)
        let after = try await Self.settled(hosted)
        #expect(after.pixelsHigh == before.pixelsHigh, "The row keeps its height: \(before.pixelsHigh) then \(after.pixelsHigh)")
        guard after.pixelsHigh == before.pixelsHigh else { return }
        let scale = before.pixelsWide / Int(Self.width)
        let band = Int(Self.facesBand) * scale
        let above = try Self.differingBytes(before, after, rows: 0 ..< (before.pixelsHigh - band), columns: 0 ..< before.pixelsWide)
        let faces = try Self.differingBytes(before, after, rows: (before.pixelsHigh - band) ..< before.pixelsHigh,
                                            columns: (before.pixelsWide - 60 * scale) ..< before.pixelsWide)
        #expect(faces > 200, "The faces drew in the corner: \(faces) bytes")
        #expect(above == 0, "Nothing above the faces' band moved or was covered: \(above) bytes")
        #expect(Self.pictureBottom(after) < after.pixelsHigh - band, "The pictures end above the faces")
      }

      /// A body ending in text keeps no corner: before the faces it is exactly as tall as the same row anywhere
      /// else, and on a short last line their arrival changes nothing but the corner (row 31b1's reserve).
      @Test func aRowEndingInTextKeepsNoCornerAndHoldsStill() async throws {
        let text = "Release notes are up."
        let hosted = Self.newestRow(Self.message(text))
        defer { hosted.window.orderOut(nil) }
        let before = try await Self.settled(hosted, pictures: false)
        let plain = Self.host(MessageRowView(message: Self.message(text), isContinuation: false, outbound: nil, onRetry: nil,
                                             onRemove: nil, horizontalInset: 12),
                              marks: RoomReadMarks(), dark: false)
        defer { plain.window.orderOut(nil) }
        let plainBitmap = try await Self.settled(plain, pictures: false)
        #expect(before.pixelsHigh == plainBitmap.pixelsHigh, "No corner kept under text: \(before.pixelsHigh) vs \(plainBitmap.pixelsHigh)")
        Self.readersArrive(hosted)
        let after = try await Self.settled(hosted, pictures: false)
        #expect(after.pixelsHigh == before.pixelsHigh, "A short last line does not rewrap: \(before.pixelsHigh) then \(after.pixelsHigh)")
        guard after.pixelsHigh == before.pixelsHigh else { return }
        let scale = before.pixelsWide / Int(Self.width)
        let rest = try Self.differingBytes(before, after, rows: 0 ..< before.pixelsHigh, columns: 0 ..< (before.pixelsWide - 60 * scale))
        #expect(rest == 0, "Only the corner changes: \(rest) bytes")
      }

      /// Web keeps the corner only when the body ends the row: reactions under the picture end it instead, so the
      /// row keeps no corner and is as tall as the same row that is not the newest.
      @Test func aPictureUnderReactionsKeepsNoCorner() async throws {
        URLProtocol.registerClass(ScrollMediaProtocol.self)
        defer { URLProtocol.unregisterClass(ScrollMediaProtocol.self) }
        let message = Self.message(Self.pictureSource, reacted: true)
        let newest = Self.newestRow(message)
        defer { newest.window.orderOut(nil) }
        let plain = Self.host(MessageRowView(message: message, isContinuation: false, outbound: nil, onRetry: nil, onRemove: nil,
                                             horizontalInset: 12),
                              marks: RoomReadMarks(), dark: false)
        defer { plain.window.orderOut(nil) }
        let newestBitmap = try await Self.settled(newest)
        let plainBitmap = try await Self.settled(plain)
        try #require(Self.pictureBottom(newestBitmap) > 0, "The picture loaded")
        #expect(newestBitmap.pixelsHigh == plainBitmap.pixelsHigh, "\(newestBitmap.pixelsHigh) vs \(plainBitmap.pixelsHigh)")
      }

      /// The recorded picture: the newest message ending in a picture and in a run of tiles, each with the faces
      /// that arrived under it, light beside dark, over the window background.
      @Test func rendersTheKeptCornerInLightAndDark() async throws {
        URLProtocol.registerClass(ScrollMediaProtocol.self)
        defer { URLProtocol.unregisterClass(ScrollMediaProtocol.self) }
        var columns: [[CGImage]] = [[], []]
        for (column, dark) in [false, true].enumerated() {
          for source in [Self.pictureSource, Self.tilesSource] {
            let hosted = Self.newestRow(Self.message(source), dark: dark)
            defer { hosted.window.orderOut(nil) }
            _ = try await Self.settled(hosted)
            Self.readersArrive(hosted)
            let bitmap = try await Self.settled(hosted)
            let corner = try #require(bitmap.colorAt(x: 1, y: bitmap.pixelsHigh - 2)?.usingColorSpace(.deviceRGB))
            #expect(corner.alphaComponent == 1, "Hosted over the window background: alpha \(corner.alphaComponent)")
            try columns[column].append(#require(bitmap.cgImage))
          }
        }
        let combined = try RoomHeaderTests.stitched(columns)
        try Attachment.record(#require(combined.representation(using: .png, properties: [:])), named: "seen-by-attachments.png")
      }
    }
  }
#endif

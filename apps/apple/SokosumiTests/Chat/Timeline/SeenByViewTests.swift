#if os(macOS)
  import AppKit
  import CoreAPI
  @testable import Sokosumi
  import SokosumiAuth
  import SokosumiChat
  import SokosumiWorkspace
  import SwiftUI
  import Testing

  extension NativeWindowTests {
    /// Row 31b1: web's `RoomSeenByLine` on the newest message — quiet faces in the row's bottom-trailing corner,
    /// colour only while the faces themselves are woken, and the popover above them naming readers and the rest.
    /// The test host builds no accessibility tree, so the tests click by position and compare pixels.
    @MainActor struct SeenByViewTests {
      private static let base = Date(timeIntervalSince1970: 1_790_251_200)

      private static func member(_ name: String, minutes: Double?, image: String? = nil) -> Components.Schemas.ChatRoomUserParticipant {
        .init(id: "user_\(name.lowercased())", name: name, email: "\(name.lowercased())@example.com", image: image,
              presence: .offline, lastReadAt: minutes.map { base.addingTimeInterval($0 * 60) })
      }

      /// Two readers past the message, one lagging and one who never opened the room.
      private static func seenBy(readers: Int = 2, image: String? = nil) -> SeenBy {
        let names = ["Grace", "Linus", "Ada", "Ken", "Barbara"]
        let readers = (0 ..< readers).map { index in
          RoomReader(participant: member(names[index], minutes: Double(10 - index), image: image),
                     lastReadAt: base.addingTimeInterval(Double(10 - index) * 60))
        }
        return SeenBy(readers: readers, pending: [member("Margaret", minutes: -30), member("Alan", minutes: nil)])
      }

      private static func message(_ content: String) -> Components.Schemas.ChatRoomMessage {
        var message = chatRoomMessage(from: .init(
          clientTurnId: content, roomId: "room_1", content: content, createdAt: base,
          sender: .init(id: "user_ben", name: "Ben", email: "ben@example.com", presence: .offline)
        ))
        message.id = content
        message.metadata = nil
        return message
      }

      private static func host(_ view: some View, width: CGFloat, dark: Bool) -> (NSHostingView<AnyView>, NSWindow) {
        let host = NSHostingView(rootView: AnyView(view
            .frame(width: width, alignment: .leading)
            .background(.background)
            .environmentObject(WorkspaceState()).environmentObject(AuthState())
            .environment(\.colorScheme, dark ? .dark : .light)
            .environment(\.locale, Locale(identifier: "en_US"))))
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: width, height: 200), styleMask: [.titled], backing: .buffered, defer: false)
        window.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        window.contentView = host
        return (host, window)
      }

      private static func renderRow(_ content: String, seenBy: SeenBy?, dark: Bool) async throws -> NSBitmapImageRep {
        let (host, window) = host(MessageRowView(message: message(content), isContinuation: false, outbound: nil, onRetry: nil,
                                                 onRemove: nil, horizontalInset: 12, seenBy: seenBy)
            .padding(.vertical, 8), width: 520, dark: dark)
        window.orderFront(nil)
        defer { window.orderOut(nil) }
        for _ in 0 ..< 8 {
          host.layoutSubtreeIfNeeded()
          try await Task.sleep(for: .milliseconds(20))
        }
        return try fittedBitmap(of: host, in: window)
      }

      private static func renderFaces(_ seenBy: SeenBy, awake: Bool) async throws -> NSBitmapImageRep {
        let (host, window) = host(SeenByFaces(seenBy: seenBy, awake: awake).padding(8), width: 80, dark: false)
        window.orderFront(nil)
        defer { window.orderOut(nil) }
        /// The avatar loads its image off the main actor and the picture settles over a few passes; under load that
        /// takes a while, so wait until the face's centre has left the initials and held one colour for ten captures.
        func centre(of bitmap: NSBitmapImageRep) -> NSColor? {
          bitmap.colorAt(x: 16 * (bitmap.pixelsWide / 80), y: 16 * (bitmap.pixelsWide / 80))
        }
        var bitmap = try fittedBitmap(of: host, in: window)
        let initials = centre(of: bitmap)
        var previous = initials
        var steady = 0
        for _ in 0 ..< 250 where steady < 10 {
          try await Task.sleep(for: .milliseconds(20))
          host.layoutSubtreeIfNeeded()
          bitmap = try fittedBitmap(of: host, in: window)
          let current = centre(of: bitmap)
          steady = current == previous && current != initials ? steady + 1 : 0
          previous = current
        }
        return bitmap
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

      /// The faces sit in the row's bottom-trailing corner, out of the text flow: the newest message is exactly as
      /// tall as it is without them, and only its trailing corner draws differently.
      @Test(arguments: [false, true])
      func facesSitInTheCornerWithoutGrowingTheRow(dark: Bool) async throws {
        let with = try await Self.renderRow("Release notes are up.", seenBy: Self.seenBy(readers: 4), dark: dark)
        let without = try await Self.renderRow("Release notes are up.", seenBy: nil, dark: dark)
        #expect(with.pixelsHigh == without.pixelsHigh, "The faces add no height: \(with.pixelsHigh) vs \(without.pixelsHigh)")
        let scale = with.pixelsWide / 520
        let corner = try Self.differingBytes(with, without, rows: (with.pixelsHigh / 2) ..< with.pixelsHigh,
                                             columns: (with.pixelsWide - 90 * scale) ..< with.pixelsWide)
        let rest = try Self.differingBytes(with, without, rows: 0 ..< with.pixelsHigh, columns: 0 ..< (with.pixelsWide - 90 * scale))
        #expect(corner > 200, "The faces draw in the bottom-trailing corner: \(corner) bytes")
        #expect(rest == 0, "Nothing else in the row changes: \(rest) bytes")
      }

      /// A long last line wraps before the faces instead of running under them.
      @Test func aLongLineStopsShortOfTheFaces() async throws {
        let long = String(repeating: "Everyone please read the launch checklist before Friday. ", count: 3)
        let with = try await Self.renderRow(long, seenBy: Self.seenBy(readers: 4), dark: false)
        let without = try await Self.renderRow(long, seenBy: nil, dark: false)
        let scale = with.pixelsWide / 520
        let facesWidth = Int(SeenByFaces.width(for: Self.seenBy(readers: 4)))
        let lane = (with.pixelsWide - (12 + facesWidth) * scale) ..< (with.pixelsWide - 12 * scale)
        // The faces themselves: 16 pt tall, 4 pt above the row's bottom edge, under the 8 pt the fixture pads.
        let faceRows = (with.pixelsHigh - (8 + 4 + 16 + 1) * scale) ..< (with.pixelsHigh - (8 + 4 - 1) * scale)
        #expect(with.pixelsHigh >= without.pixelsHigh)
        let blank = try #require(with.colorAt(x: with.pixelsWide - 2, y: 2))
        var inked = 0
        for row in 0 ..< with.pixelsHigh where !faceRows.contains(row) {
          for column in lane where with.colorAt(x: column, y: row) != blank {
            inked += 1
          }
        }
        // Without the reserve the same text runs into the lane, so the check can fail.
        var inkedWithout = 0
        for row in 0 ..< without.pixelsHigh {
          for column in lane where without.colorAt(x: column, y: row) != blank {
            inkedWithout += 1
          }
        }
        #expect(inkedWithout > 0, "The fixture's text reaches the trailing edge without faces")
        #expect(inked == 0, "No text in the faces' lane: \(inked) pixels")
      }

      /// Quiet faces are grey at half strength; woken, they show their colour.
      @Test func facesStayGreyUntilWoken() async throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("seen-by-red-\(UUID().uuidString).png")
        let red = try #require(NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 32, pixelsHigh: 32, bitsPerSample: 8, samplesPerPixel: 4,
                                                hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0))
        for column in 0 ..< 32 {
          for row in 0 ..< 32 {
            red.setColor(NSColor(deviceRed: 0.9, green: 0.1, blue: 0.1, alpha: 1), atX: column, y: row)
          }
        }
        try #require(red.representation(using: .png, properties: [:])).write(to: url)
        defer { try? FileManager.default.removeItem(at: url) }
        let seenBy = Self.seenBy(readers: 1, image: url.absoluteString)
        let quiet = try await Self.renderFaces(seenBy, awake: false)
        let awake = try await Self.renderFaces(seenBy, awake: true)
        // The first face's centre: 8 pt of padding plus half of the 16 pt face.
        let scale = quiet.pixelsWide / 80
        let centre = (x: 16 * scale, y: 16 * scale)
        let quietPixel = try #require(quiet.colorAt(x: centre.x, y: centre.y)?.usingColorSpace(.deviceRGB))
        let awakePixel = try #require(awake.colorAt(x: centre.x, y: centre.y)?.usingColorSpace(.deviceRGB))
        #expect(awakePixel.redComponent - awakePixel.greenComponent > 0.5, "Woken, the face is red: \(awakePixel)")
        // The cached-display capture applies the opacity but not SwiftUI's grayscale filter (a real window applies
        // both), so here the quiet face is the woken one at half strength over white; `quietToneIsGreyAtHalfOpacity`
        // renders the grey.
        #expect(abs(quietPixel.greenComponent - (1 + awakePixel.greenComponent) / 2) < 0.06, "Quiet, half opacity: \(quietPixel) vs \(awakePixel)")
      }

      /// The quiet tone itself, rendered by SwiftUI with its filters: grey at half opacity; woken, untouched.
      @Test func quietToneIsGreyAtHalfOpacity() throws {
        func pixel(awake: Bool) throws -> NSColor {
          let renderer = ImageRenderer(content: Rectangle().fill(Color(red: 0.9, green: 0.1, blue: 0.1)).frame(width: 8, height: 8)
            .modifier(SeenByTone(awake: awake)))
          let image = try #require(renderer.cgImage)
          return try #require(NSBitmapImageRep(cgImage: image).colorAt(x: image.width / 2, y: image.height / 2)?.usingColorSpace(.deviceRGB))
        }
        let quiet = try pixel(awake: false)
        let awake = try pixel(awake: true)
        #expect(abs(quiet.redComponent - quiet.greenComponent) < 0.02 && abs(quiet.greenComponent - quiet.blueComponent) < 0.02, "Grey: \(quiet)")
        #expect(abs(quiet.alphaComponent - 0.5) < 0.02, "Half opacity: \(quiet)")
        #expect(awake.redComponent - awake.greenComponent > 0.6 && awake.alphaComponent == 1, "Woken, its own colour: \(awake)")
      }

      /// A click on the faces opens the popover above them, listing readers with times and then the rest.
      @Test func aClickOpensTheListAboveTheFaces() async throws {
        let (host, window) = Self.host(SeenByButton(seenBy: Self.seenBy()).padding(.top, 360).padding(.horizontal, 120).padding(.bottom, 20),
                                       width: 400, dark: false)
        window.setContentSize(NSSize(width: 400, height: 400))
        window.center()
        window.makeKeyAndOrderFront(nil)
        defer { window.orderOut(nil) }
        let before = Set(NSApp.windows.map(ObjectIdentifier.init))
        let bitmap = try fittedBitmap(of: host, in: window)
        let scale = CGFloat(bitmap.pixelsWide) / host.bounds.width
        let facesWidth = SeenByFaces.width(for: Self.seenBy())
        clickPixel(CGPoint(x: (120 + facesWidth / 2) * scale, y: (360 + SeenByFaces.faceDiameter / 2) * scale),
                   of: bitmap, drawnFrom: host, in: window)
        var popover: NSWindow?
        for _ in 0 ..< 100 where popover == nil {
          try await Task.sleep(for: .milliseconds(20))
          popover = NSApp.windows.first { !before.contains(ObjectIdentifier($0)) && $0.isVisible && String(describing: type(of: $0)).contains("Popover") }
        }
        let shown = try #require(popover, "A popover window opened")
        defer { shown.orderOut(nil) }
        let facesMiddle = window.convertToScreen(host.convert(NSRect(x: 120, y: 360 + SeenByFaces.faceDiameter / 2, width: facesWidth, height: 0), to: nil))
        #expect(shown.frame.minY >= facesMiddle.minY, "Above the faces: popover \(shown.frame), faces \(facesMiddle)")
        try await Task.sleep(for: .milliseconds(200))
        let content = try #require(shown.contentView)
        let picture = try #require(content.bitmapImageRepForCachingDisplay(in: content.bounds))
        content.cacheDisplay(in: content.bounds, to: picture)
        guard let lines = try RoomThreadOverviewGroupsViewTests.recognizedText(in: picture) else { return }
        let texts = lines.map(\.text).joined(separator: " | ")
        // Vision reads the names in the rendered list below; here it confirms this window is that list.
        for fragment in ["Read by", "Alan"] {
          #expect(texts.contains(fragment), "\(fragment) in \(texts)")
        }
      }

      /// The recorded picture: the newest message with two and with four readers, the woken faces, and the list,
      /// light beside dark, each over the window background.
      @Test func rendersSeenByInLightAndDark() async throws {
        var columns: [[CGImage]] = [[], []]
        for (column, dark) in [false, true].enumerated() {
          for (content, readers) in [("Release notes are up.", 2), ("Who owns the launch copy? Reply in the thread.", 4)] {
            try await columns[column].append(#require(Self.renderRow(content, seenBy: Self.seenBy(readers: readers), dark: dark).cgImage))
          }
          let (detailHost, detailWindow) = Self.host(SeenByDetail(seenBy: Self.seenBy(readers: 4)).padding(8), width: SeenByDetail.width + 16, dark: dark)
          detailWindow.orderFront(nil)
          defer { detailWindow.orderOut(nil) }
          for _ in 0 ..< 8 {
            detailHost.layoutSubtreeIfNeeded()
            try await Task.sleep(for: .milliseconds(20))
          }
          let detail = try fittedBitmap(of: detailHost, in: detailWindow)
          let corner = try #require(detail.colorAt(x: 1, y: detail.pixelsHigh - 2)?.usingColorSpace(.deviceRGB))
          #expect(corner.alphaComponent == 1, "Hosted over the window background: alpha \(corner.alphaComponent)")
          try columns[column].append(#require(detail.cgImage))
          if let lines = try RoomThreadOverviewGroupsViewTests.recognizedText(in: detail) {
            let texts = lines.map(\.text).joined(separator: " | ")
            for fragment in ["Read by", "Grace", "Ken", "Margaret", "Alan"] {
              #expect(texts.contains(fragment), "\(fragment) in \(texts)")
            }
          }
        }
        let combined = try RoomHeaderTests.stitched(columns)
        try Attachment.record(#require(combined.representation(using: .png, properties: [:])), named: "seen-by.png")
      }
    }
  }
#endif

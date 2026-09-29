#if os(macOS)
  import AppKit
  @testable import Sokosumi
  import SokosumiChat
  import SwiftUI
  import Testing

  /// The composer's draft rows hosted in a window over the window background.
  @MainActor private final class ComposerDraftFixture {
    let uploads: ComposeUploads
    let host: NSHostingView<AnyView>
    let window: NSWindow
    private let defaultsName: String

    init(_ attachments: [ComposeAttachment], width: CGFloat, dark: Bool = false) throws {
      defaultsName = "composer-attachments-\(UUID().uuidString)"
      let defaults = try #require(UserDefaults(suiteName: defaultsName))
      let uploads = ComposeUploads(savedDraft: SavedComposeDraft(userId: "me", organizationId: nil, roomId: "room", defaults: defaults))
      attachments.forEach(uploads.add)
      self.uploads = uploads
      host = NSHostingView(rootView: AnyView(VStack(alignment: .leading, spacing: 6) {
        ComposerAttachmentsView(uploads: uploads)
      }
      .padding(12)
      .frame(width: width, alignment: .leading)
      .background(Color(nsColor: .windowBackgroundColor))
      .environment(\.colorScheme, dark ? .dark : .light)))
      window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: width, height: 400), styleMask: [.titled, .resizable], backing: .buffered, defer: false)
      window.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
      window.contentView = host
      window.orderFront(nil)
    }

    func close() {
      uploads.cancel()
      if let sheet = window.attachedSheet {
        window.endSheet(sheet)
      }
      window.orderOut(nil)
      UserDefaults.standard.removePersistentDomain(forName: defaultsName)
    }

    func bitmap() throws -> NSBitmapImageRep {
      host.layoutSubtreeIfNeeded()
      let bitmap = try #require(host.bitmapImageRepForCachingDisplay(in: host.bounds))
      host.cacheDisplay(in: host.bounds, to: bitmap)
      return bitmap
    }

    /// Waits until `count` image tiles have drawn, then returns them in points, top to bottom and left to right.
    func imageTiles(_ count: Int) async throws -> [CGRect] {
      var tiles: [CGRect] = []
      for _ in 0 ..< 250 {
        window.setContentSize(host.fittingSize)
        let shot = try bitmap()
        let scale = CGFloat(shot.pixelsWide) / host.bounds.width
        tiles = Self.greenRegions(shot).map { $0.applying(CGAffineTransform(scaleX: 1 / scale, y: 1 / scale)) }
        if tiles.count == count, tiles.allSatisfy({ $0.width > 60 && $0.height > 60 }) {
          break
        }
        try await Task.sleep(for: .milliseconds(20))
      }
      if tiles.count != count {
        try Attachment.record(#require(bitmap().representation(using: .png, properties: [:])), named: "composer-draft-tiles.png")
      }
      try #require(tiles.count == count, "The composer drew \(tiles.count) of \(count) image tiles.")
      return tiles
    }

    func click(_ point: CGPoint) throws {
      let shot = try bitmap()
      let scale = CGFloat(shot.pixelsWide) / host.bounds.width
      clickPixel(CGPoint(x: point.x * scale, y: point.y * scale), of: shot, drawnFrom: host, in: window)
    }

    func sheet() async throws -> NSWindow? {
      for _ in 0 ..< 150 {
        if let sheet = window.attachedSheet, sheet.contentView != nil {
          return sheet
        }
        try await Task.sleep(for: .milliseconds(20))
      }
      return window.attachedSheet
    }

    private static func isGreen(_ bitmap: NSBitmapImageRep, _ column: Int, _ row: Int) -> Bool {
      var pixel = [Int](repeating: 0, count: max(bitmap.samplesPerPixel, 4))
      bitmap.getPixel(&pixel, atX: column, y: row)
      let top = Double((1 << bitmap.bitsPerSample) - 1)
      return Double(pixel[0]) / top < 0.6 && Double(pixel[1]) / top > 0.7 && Double(pixel[2]) / top < 0.35
    }

    /// Connected green regions in pixels, keeping the gap between tiles that share rows.
    private static func greenRegions(_ bitmap: NSBitmapImageRep) -> [CGRect] {
      var regions: [CGRect] = []
      for row in stride(from: 0, to: bitmap.pixelsHigh, by: 2) {
        var runs: [ClosedRange<Int>] = []
        for column in stride(from: 0, to: bitmap.pixelsWide, by: 2) where isGreen(bitmap, column, row) {
          if let last = runs.last, column - last.upperBound <= 4 {
            runs[runs.count - 1] = last.lowerBound ... column
          } else {
            runs.append(column ... column)
          }
        }
        for run in runs {
          let strip = CGRect(x: run.lowerBound, y: row, width: run.upperBound - run.lowerBound + 2, height: 2)
          if let index = regions.indices.last(where: { CGFloat(row) - regions[$0].maxY <= 4 && regions[$0].minX <= strip.maxX && strip.minX <= regions[$0].maxX }) {
            regions[index] = regions[index].union(strip)
          } else {
            regions.append(strip)
          }
        }
      }
      return regions.sorted { abs($0.minY - $1.minY) > 4 ? $0.minY < $1.minY : $0.minX < $1.minX }
    }
  }

  extension NativeWindowTests {
    /// Row 14a2: the composer's finished uploads as web's `FileChipMiniPreview` tiles — 64 pt, wrapping
    /// with 8 pt gaps, images cropped to squares that open their viewer, documents by file-type icon —
    /// each with a Remove control on its corner. The fixture images are the green SVGs of
    /// `ScrollMediaProtocol`, so a tile is found by its green fill.
    @MainActor struct ComposerAttachmentsViewTests {
      private static let base = "https://scroll-fixture.invalid/composer-drafts"

      private static func image(_ name: String, _ shape: String) -> ComposeAttachment {
        ComposeAttachment(url: "\(base)/\(name).svg?format=svg&shape=\(shape)", fileName: "\(name).svg", mediaType: "image/svg+xml", size: 48000)
      }

      private static let pdf = ComposeAttachment(url: "\(base)/report.pdf", fileName: "report.pdf", mediaType: "application/pdf", size: 1_500_000)

      @Test(arguments: [CGFloat(420), 170])
      func imageDraftsAreSquareTilesThatWrap(width: CGFloat) async throws {
        URLProtocol.registerClass(ScrollMediaProtocol.self)
        defer { URLProtocol.unregisterClass(ScrollMediaProtocol.self) }
        let fixture = try ComposerDraftFixture([Self.image("a", "landscape"), Self.pdf, Self.image("b", "portrait")], width: width)
        defer { fixture.close() }
        let tiles = try await fixture.imageTiles(2)
        for tile in tiles {
          #expect(abs(tile.width - 64) < 3 && abs(tile.height - 64) < 3, "An image draft is a 64 pt square crop: \(tile).")
        }
        if width == 420 {
          #expect(abs(tiles[1].minY - tiles[0].minY) < 3, "Three drafts share one row when they fit.")
          #expect(abs(tiles[1].minX - tiles[0].minX - 144) < 3, "The document tile sits between the images with 8 pt gaps.")
        } else {
          #expect(tiles[1].minY - tiles[0].maxY > 4, "The third draft wraps to a second row, as web's flex-wrap.")
          #expect(abs(tiles[1].minX - tiles[0].minX) < 3, "A wrapped row starts at the leading edge.")
        }
      }

      @Test func clickingADraftOpensItsViewer() async throws {
        URLProtocol.registerClass(ScrollMediaProtocol.self)
        defer { URLProtocol.unregisterClass(ScrollMediaProtocol.self) }
        let fixture = try ComposerDraftFixture([Self.image("a", "landscape"), Self.pdf], width: 420)
        defer { fixture.close() }
        let tile = try #require(await fixture.imageTiles(1).first)
        try fixture.click(CGPoint(x: tile.midX - 12, y: tile.midY + 12))
        let imageSheet = try #require(await fixture.sheet(), "A draft image opens the image viewer.")
        fixture.window.endSheet(imageSheet)
        for _ in 0 ..< 100 where fixture.window.attachedSheet != nil {
          try await Task.sleep(for: .milliseconds(20))
        }
        try fixture.click(CGPoint(x: tile.maxX + 8 + 32, y: tile.midY + 12))
        #expect(try await fixture.sheet() != nil, "A draft document opens the document viewer.")
        #expect(fixture.uploads.attachments.count == 2, "Opening a preview keeps the draft.")
      }

      @Test func removeSitsOnTheTileCornerAndDropsOnlyThatDraft() async throws {
        URLProtocol.registerClass(ScrollMediaProtocol.self)
        defer { URLProtocol.unregisterClass(ScrollMediaProtocol.self) }
        let first = Self.image("a", "landscape"), second = Self.image("b", "portrait")
        let fixture = try ComposerDraftFixture([first, Self.pdf, second], width: 420)
        defer { fixture.close() }
        let tile = try #require(await fixture.imageTiles(2).first)
        // Web's 20 px round control inset 4 px from the top-trailing corner.
        try fixture.click(CGPoint(x: tile.maxX - 14, y: tile.minY + 14))
        for _ in 0 ..< 100 where fixture.uploads.attachments.count == 3 {
          try await Task.sleep(for: .milliseconds(20))
        }
        #expect(fixture.uploads.attachments == [Self.pdf, second])
        #expect(fixture.window.attachedSheet == nil, "Remove does not open the preview under it.")
      }

      @Test(arguments: [false, true])
      func rendersDraftChips(dark: Bool) async throws {
        URLProtocol.registerClass(ScrollMediaProtocol.self)
        defer { URLProtocol.unregisterClass(ScrollMediaProtocol.self) }
        let docx = ComposeAttachment(url: "\(Self.base)/plan.docx", fileName: "Plan.docx",
                                     mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
        let fixture = try ComposerDraftFixture([Self.image("a", "landscape"), Self.image("b", "portrait"), Self.pdf, docx], width: 420, dark: dark)
        defer { fixture.close() }
        // An upload in flight keeps the native progress row and its Cancel below the tiles.
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("draft-render-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: folder) }
        let scratch = folder.appendingPathComponent("notes.txt")
        try Data("draft".utf8).write(to: scratch)
        fixture.uploads.upload([scratch]) { _ in
          try await Task.sleep(for: .seconds(60))
          throw CancellationError()
        }
        _ = try await fixture.imageTiles(2)
        fixture.window.setContentSize(fixture.host.fittingSize)
        let shot = try fixture.bitmap()
        try Attachment.record(#require(shot.representation(using: .png, properties: [:])), named: "composer-draft-attachments-\(dark ? "dark" : "light").png")
      }
    }
  }
#endif

#if os(macOS)
  import AppKit
  @testable import Sokosumi
  import SokosumiAuth
  import SokosumiChat
  import SokosumiWorkspace
  import SwiftUI
  import Testing

  /// The three fixture images, told apart in the viewer by their proportions.
  private enum GalleryShape: String {
    case landscape, portrait, wide
  }

  /// A message body hosted in a window that attaches the viewer sheet.
  @MainActor private final class GalleryFixture {
    let host: NSHostingView<AnyView>
    let window: NSWindow

    init(host: NSHostingView<AnyView>, window: NSWindow) {
      self.host = host
      self.window = window
    }
  }

  extension NativeWindowTests {
    /// Row 15b: one viewer per message over that message's images, as web's `ImageViewer` over
    /// `messageImageGallery`. The body renders in a real `MessageMarkdownView`; the viewer is the sheet
    /// a click on an image attaches. The three fixture images are SVGs of distinct shapes, so the sheet
    /// says which one it shows by the proportions of its green fill.
    @MainActor struct MessageImageGalleryViewerTests {
      private static let base = "https://scroll-fixture.invalid"

      private static func link(_ name: String, _ shape: GalleryShape, run: UUID, delay: Double? = nil) -> String {
        "[\(name).svg](\(base)/\(run)/\(name).svg?format=svg&shape=\(shape.rawValue)\(delay.map { "&delay=\($0)" } ?? ""))"
      }

      /// Two images in one row, words, a PDF and the third image: all three images are the gallery.
      private static func threeImages(_ run: UUID, delay: Double? = nil, dropping dropped: String? = nil) -> String {
        let first = [("a", GalleryShape.landscape), ("b", .portrait)].filter { $0.0 != dropped }.map { link($0.0, $0.1, run: run) }
        let last = dropped == "c" ? "" : link("c", .wide, run: run, delay: delay)
        return first.joined(separator: " ") + "\n\nThe photos from Friday.\n\n[notes.pdf](\(base)/\(run)/notes.pdf)\n\nAnd the view:\n\n" + last
      }

      private static func view(_ source: String, dark: Bool) -> AnyView {
        AnyView(MessageMarkdownView(source: source)
          .padding(12)
          .frame(width: 400, alignment: .leading)
          .background(.background)
          .environmentObject(WorkspaceState()).environmentObject(AuthState())
          .environment(\.colorScheme, dark ? .dark : .light))
      }

      private static func fixture(_ source: String, dark: Bool = false) -> GalleryFixture {
        let host = NSHostingView(rootView: view(source, dark: dark))
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 400, height: 1000), styleMask: [.titled, .resizable], backing: .buffered, defer: false)
        window.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        window.contentView = host
        window.orderFront(nil)
        return GalleryFixture(host: host, window: window)
      }

      private static func close(_ fixture: GalleryFixture) {
        if let sheet = fixture.window.attachedSheet {
          fixture.window.endSheet(sheet)
        }
        fixture.window.orderOut(nil)
      }

      private static func bitmap(_ view: NSView) throws -> NSBitmapImageRep {
        view.layoutSubtreeIfNeeded()
        let bitmap = try #require(view.bitmapImageRepForCachingDisplay(in: view.bounds))
        view.cacheDisplay(in: view.bounds, to: bitmap)
        return bitmap
      }

      /// The fixture's rgb(76, 217, 38), read from the raw samples: `colorAt` is too slow for a whole sheet.
      private static func isFixtureGreen(_ bitmap: NSBitmapImageRep, _ column: Int, _ row: Int) -> Bool {
        var pixel = [Int](repeating: 0, count: max(bitmap.samplesPerPixel, 4))
        bitmap.getPixel(&pixel, atX: column, y: row)
        let top = (1 << bitmap.bitsPerSample) - 1
        let red = Double(pixel[0]) / Double(top), green = Double(pixel[1]) / Double(top), blue = Double(pixel[2]) / Double(top)
        return green > 0.7 && blue < 0.35 && red < 0.6
      }

      /// Connected green regions, top to bottom and left to right. Adjacent thumbnails share
      /// vertical bands, so preserve the gap between their columns when finding a click target.
      private static func greenBands(_ bitmap: NSBitmapImageRep) -> [(rows: ClosedRange<Int>, columns: ClosedRange<Int>)] {
        var bands: [(rows: ClosedRange<Int>, columns: ClosedRange<Int>)] = []
        for row in stride(from: 0, to: bitmap.pixelsHigh, by: 2) {
          let columns = stride(from: 0, to: bitmap.pixelsWide, by: 2).filter { isFixtureGreen(bitmap, $0, row) }
          var runs: [ClosedRange<Int>] = []
          for column in columns {
            if let last = runs.last, column - last.upperBound <= 4 {
              runs[runs.count - 1] = last.lowerBound ... column
            } else {
              runs.append(column ... column)
            }
          }
          for run in runs {
            if let index = bands.indices.last(where: { row - bands[$0].rows.upperBound <= 4 && bands[$0].columns.overlaps(run) }) {
              let open = bands[index]
              bands[index] = (open.rows.lowerBound ... row, min(open.columns.lowerBound, run.lowerBound) ... max(open.columns.upperBound, run.upperBound))
            } else {
              bands.append((row ... row, run))
            }
          }
        }
        return bands
      }

      /// Waits for the transcript's images, then clicks the one at `index`.
      private static func openImage(_ index: Int, in fixture: GalleryFixture, count: Int) async throws {
        var bands: [(rows: ClosedRange<Int>, columns: ClosedRange<Int>)] = []
        var shot = try bitmap(fixture.host)
        for _ in 0 ..< 250 where bands.count < count {
          try await Task.sleep(for: .milliseconds(20))
          shot = try bitmap(fixture.host)
          bands = greenBands(shot)
        }
        if bands.count != count {
          try Attachment.record(#require(shot.representation(using: .png, properties: [:])), named: "message-image-gallery-transcript.png")
        }
        try #require(bands.count == count, "The transcript drew \(bands.count) of \(count) images.")
        let band = bands[index]
        clickPixel(CGPoint(x: (band.columns.lowerBound + band.columns.upperBound) / 2, y: (band.rows.lowerBound + band.rows.upperBound) / 2),
                   of: shot, drawnFrom: fixture.host, in: fixture.window)
      }

      private static func sheet(of fixture: GalleryFixture) async throws -> NSWindow {
        for _ in 0 ..< 250 {
          if let sheet = fixture.window.attachedSheet, sheet.contentView != nil {
            return sheet
          }
          try await Task.sleep(for: .milliseconds(20))
        }
        return try #require(fixture.window.attachedSheet, "No viewer sheet was attached.")
      }

      /// The sheet's content drawn over the window background in the sheet's appearance: the sheet's
      /// own backdrop is window chrome that `cacheDisplay` does not draw, so the content alone is transparent.
      private static func sheetBitmap(_ sheet: NSWindow) throws -> NSBitmapImageRep {
        let content = try #require(sheet.contentView)
        let drawn = try bitmap(content)
        let opaque = try #require(NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: drawn.pixelsWide, pixelsHigh: drawn.pixelsHigh,
                                                   bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                                                   colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0))
        let bounds = NSRect(x: 0, y: 0, width: drawn.pixelsWide, height: drawn.pixelsHigh)
        NSGraphicsContext.saveGraphicsState()
        defer { NSGraphicsContext.restoreGraphicsState() }
        NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: opaque)
        sheet.effectiveAppearance.performAsCurrentDrawingAppearance {
          NSColor.windowBackgroundColor.setFill()
          bounds.fill()
        }
        drawn.draw(in: bounds, from: .zero, operation: .sourceOver, fraction: 1, respectFlipped: false, hints: nil)
        return opaque
      }

      /// The image the sheet shows, by its proportions; nil while none is drawn.
      private static func shownShape(_ sheet: NSWindow) throws -> GalleryShape? {
        let bands = try greenBands(sheetBitmap(sheet))
        guard let band = bands.max(by: { $0.rows.count < $1.rows.count }) else { return nil }
        let ratio = Double(band.columns.count) / Double(band.rows.count)
        return ratio > 4 ? .wide : (ratio < 0.8 ? .portrait : .landscape)
      }

      private static func waitForShape(_ shape: GalleryShape, in sheet: NSWindow, _ message: String) async throws {
        for _ in 0 ..< 250 {
          if try shownShape(sheet) == shape {
            return
          }
          try await Task.sleep(for: .milliseconds(20))
        }
        let shown = try shownShape(sheet)
        if shown != shape {
          try Attachment.record(#require(sheetBitmap(sheet).representation(using: .png, properties: [:])), named: "message-image-gallery-\(shape).png")
        }
        #expect(shown == shape, "\(message) Shown: \(String(describing: shown)).")
      }

      /// A key press where `NSApplication.sendEvent` offers it first: the key window's key equivalents,
      /// whatever holds focus. True when a control took it.
      private static func press(_ keyCode: UInt16, _ character: Int, in sheet: NSWindow) throws -> Bool {
        let characters = String(UnicodeScalar(character).map(Character.init) ?? " ")
        let event = try #require(NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: [.function, .numericPad],
                                                  timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: sheet.windowNumber, context: nil,
                                                  characters: characters, charactersIgnoringModifiers: characters, isARepeat: false, keyCode: keyCode))
        return sheet.performKeyEquivalent(with: event)
      }

      @discardableResult
      private static func pressLeft(in sheet: NSWindow) throws -> Bool {
        try press(123, NSLeftArrowFunctionKey, in: sheet)
      }

      @discardableResult
      private static func pressRight(in sheet: NSWindow) throws -> Bool {
        try press(124, NSRightArrowFunctionKey, in: sheet)
      }

      /// Where the step control on `edge` sits, in bitmap pixels: a 44 pt circle 16 pt inside the image
      /// area, which the sheet pads by 16 pt, level with the middle of the centred image.
      private static func stepControlPoint(_ edge: HorizontalEdge, in shot: NSBitmapImageRep, of sheet: NSWindow) throws -> CGPoint {
        let content = try #require(sheet.contentView)
        let scale = CGFloat(shot.pixelsWide) / content.bounds.width
        let band = try #require(greenBands(shot).max { $0.rows.count < $1.rows.count }, "The sheet shows an image.")
        let inset = (16 + 16 + 22) * scale
        return CGPoint(x: edge == .leading ? inset : CGFloat(shot.pixelsWide) - inset, y: CGFloat(band.rows.lowerBound + band.rows.upperBound) / 2)
      }

      /// Whether the step control on `edge` is drawn: its scrim, beside the chevron, differs from the
      /// sheet's background. Only for an image narrow enough to leave the edges to the background.
      private static func drawsStepControl(_ edge: HorizontalEdge, in sheet: NSWindow) throws -> Bool {
        let shot = try sheetBitmap(sheet)
        let point = try stepControlPoint(edge, in: shot, of: sheet)
        let scale = CGFloat(shot.pixelsWide) / (sheet.contentView?.bounds.width ?? 1)
        let scrim = try #require(shot.colorAt(x: Int(point.x + 15 * scale), y: Int(point.y))?.usingColorSpace(.deviceRGB))
        let background = try #require(shot.colorAt(x: 2, y: Int(point.y))?.usingColorSpace(.deviceRGB))
        // The background is one flat fill, so any difference is the control; in dark the scrim sits
        // about 0.07 per channel below it.
        let difference = abs(scrim.redComponent - background.redComponent) + abs(scrim.greenComponent - background.greenComponent)
          + abs(scrim.blueComponent - background.blueComponent)
        return difference > 0.1
      }

      private static func click(_ edge: HorizontalEdge, in sheet: NSWindow) throws {
        let content = try #require(sheet.contentView)
        let shot = try sheetBitmap(sheet)
        try clickPixel(stepControlPoint(edge, in: shot, of: sheet), of: shot, drawnFrom: content, in: sheet)
      }

      /// Web: the viewer opens on the clicked image; ← / → and the edge controls step through the
      /// message's images in body order and stop at the ends.
      @Test func stepsThroughTheMessagesImagesAndStopsAtTheEnds() async throws {
        URLProtocol.registerClass(ScrollMediaProtocol.self)
        defer { URLProtocol.unregisterClass(ScrollMediaProtocol.self) }
        let fixture = Self.fixture(Self.threeImages(UUID()))
        defer { Self.close(fixture) }
        try await Self.openImage(1, in: fixture, count: 3)
        let sheet = try await Self.sheet(of: fixture)
        try await Self.waitForShape(.portrait, in: sheet, "The viewer opens on the clicked image.")

        #expect(try Self.pressRight(in: sheet), "→ is the Next control's key.")
        try await Self.waitForShape(.wide, in: sheet, "→ steps to the next image, over the PDF.")
        #expect(try !Self.pressRight(in: sheet), "→ at the last image finds no enabled control.")
        try Self.click(.trailing, in: sheet)
        try await Task.sleep(for: .milliseconds(150))
        #expect(try Self.shownShape(sheet) == .wide, "→ and Next at the last image are inert.")

        try Self.click(.leading, in: sheet)
        try await Self.waitForShape(.portrait, in: sheet, "Previous steps back.")
        // After a click the arrows still step: AppKit offers a key to the window's key equivalents first.
        #expect(try Self.pressLeft(in: sheet), "← is the Previous control's key.")
        try await Self.waitForShape(.landscape, in: sheet, "← steps to the first image.")
        try Self.click(.leading, in: sheet)
        #expect(try !Self.pressLeft(in: sheet), "← at the first image finds no enabled control.")
        try await Task.sleep(for: .milliseconds(150))
        #expect(try Self.shownShape(sheet) == .landscape, "Previous and ← at the first image are inert.")
        try Self.click(.trailing, in: sheet)
        try await Self.waitForShape(.portrait, in: sheet, "Next steps forward.")
      }

      /// Web preloads the open image's neighbours, so a step shows a loaded image: the last image
      /// answers only after 400 ms, yet shows at once when stepped to after that.
      @Test func aStepShowsThePreloadedNeighbourAtOnce() async throws {
        URLProtocol.registerClass(ScrollMediaProtocol.self)
        defer { URLProtocol.unregisterClass(ScrollMediaProtocol.self) }
        let fixture = Self.fixture(Self.threeImages(UUID(), delay: 0.4))
        defer { Self.close(fixture) }
        try await Self.openImage(1, in: fixture, count: 3)
        let sheet = try await Self.sheet(of: fixture)
        try await Self.waitForShape(.portrait, in: sheet, "The viewer opens on the clicked image.")
        // The fixture answers every request anew (nothing is cached), so only a preload can have it ready.
        try await Task.sleep(for: .milliseconds(600))
        try Self.pressRight(in: sheet)
        var shown: GalleryShape?
        for _ in 0 ..< 5 where shown != .wide {
          try await Task.sleep(for: .milliseconds(20))
          shown = try Self.shownShape(sheet)
        }
        #expect(shown == .wide, "The next image was not preloaded: \(String(describing: shown)) within 100 ms of the step.")
      }

      /// Web: the viewer follows the live message — an edit dropping another image keeps it on its
      /// image, dropping the open image closes it, and bringing the file back does not reopen it.
      @Test func theViewerFollowsTheLiveMessage() async throws {
        URLProtocol.registerClass(ScrollMediaProtocol.self)
        defer { URLProtocol.unregisterClass(ScrollMediaProtocol.self) }
        let run = UUID()
        let fixture = Self.fixture(Self.threeImages(run))
        defer { Self.close(fixture) }
        try await Self.openImage(1, in: fixture, count: 3)
        let sheet = try await Self.sheet(of: fixture)
        try await Self.waitForShape(.portrait, in: sheet, "The viewer opens on the clicked image.")

        fixture.host.rootView = Self.view(Self.threeImages(run, dropping: "a"), dark: false)
        try await Task.sleep(for: .milliseconds(300))
        #expect(fixture.window.attachedSheet === sheet, "Dropping another image keeps the viewer open.")
        try Self.pressLeft(in: sheet)
        try await Task.sleep(for: .milliseconds(150))
        #expect(try Self.shownShape(sheet) == .portrait, "The dropped image is no longer a step away.")

        fixture.host.rootView = Self.view(Self.threeImages(run, dropping: "b"), dark: false)
        for _ in 0 ..< 250 where fixture.window.attachedSheet != nil {
          try await Task.sleep(for: .milliseconds(20))
        }
        #expect(fixture.window.attachedSheet == nil, "The open image left the message: the viewer closes.")

        fixture.host.rootView = Self.view(Self.threeImages(run), dark: false)
        try await Task.sleep(for: .milliseconds(400))
        #expect(fixture.window.attachedSheet == nil, "The file coming back does not reopen the viewer.")
      }

      /// Web: one image shows no position and no step controls.
      @Test func oneImageHasNoStepControls() async throws {
        URLProtocol.registerClass(ScrollMediaProtocol.self)
        defer { URLProtocol.unregisterClass(ScrollMediaProtocol.self) }
        let fixture = Self.fixture("Only one: " + Self.link("b", .portrait, run: UUID()))
        defer { Self.close(fixture) }
        try await Self.openImage(0, in: fixture, count: 1)
        let sheet = try await Self.sheet(of: fixture)
        try await Self.waitForShape(.portrait, in: sheet, "The viewer opens on the image.")
        #expect(try !Self.drawsStepControl(.leading, in: sheet))
        #expect(try !Self.drawsStepControl(.trailing, in: sheet))
        if let lines = try RoomThreadOverviewGroupsViewTests.recognizedText(in: Self.sheetBitmap(sheet)) {
          #expect(!lines.contains { $0.text.contains(" / ") }, "No position for one image: \(lines.map(\.text))")
        }
      }

      /// The viewer on the middle of three images, light and dark: the position before the file name
      /// and both step controls, over the sheet's own background.
      @Test(arguments: [false, true])
      func rendersThePositionAndTheStepControls(dark: Bool) async throws {
        URLProtocol.registerClass(ScrollMediaProtocol.self)
        defer { URLProtocol.unregisterClass(ScrollMediaProtocol.self) }
        let fixture = Self.fixture(Self.threeImages(UUID()), dark: dark)
        defer { Self.close(fixture) }
        try await Self.openImage(1, in: fixture, count: 3)
        let sheet = try await Self.sheet(of: fixture)
        sheet.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        try await Self.waitForShape(.portrait, in: sheet, "The viewer opens on the clicked image.")
        try await Task.sleep(for: .milliseconds(300))
        let shot = try Self.sheetBitmap(sheet)
        try Attachment.record(#require(shot.representation(using: .png, properties: [:])), named: "message-image-gallery-\(dark ? "dark" : "light").png")
        let corner = try #require(shot.colorAt(x: 2, y: shot.pixelsHigh - 2)?.usingColorSpace(.deviceRGB))
        #expect(corner.alphaComponent == 1, "Drawn over the sheet's background: alpha \(corner.alphaComponent)")
        #expect(dark ? corner.brightnessComponent < 0.5 : corner.brightnessComponent > 0.5)
        #expect(try Self.drawsStepControl(.leading, in: sheet), "Previous beside the image.")
        #expect(try Self.drawsStepControl(.trailing, in: sheet), "Next beside the image.")
        // Vision reads text only on a local run (the CI runner returns nil); the pixel checks carry the rest.
        guard let lines = try RoomThreadOverviewGroupsViewTests.recognizedText(in: shot) else { return }
        // Vision reads the bar as one line, spaces optional: "2 / 3 b.svg".
        let bar = try #require(lines.map { $0.text.replacingOccurrences(of: " ", with: "") }.first { $0.contains("b.svg") },
                               "The file name: \(lines.map(\.text))")
        let position = try #require(bar.range(of: "2/3"), "The position in \(bar)")
        let name = try #require(bar.range(of: "b.svg"))
        #expect(position.upperBound <= name.lowerBound, "The position stands before the file name: \(bar)")
      }
    }
  }
#endif

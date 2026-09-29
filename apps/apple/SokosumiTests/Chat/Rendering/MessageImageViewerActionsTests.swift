#if os(macOS)
  import AppKit
  @testable import Sokosumi
  import SokosumiAuth
  import SokosumiChat
  import SokosumiWorkspace
  import SwiftUI
  import Testing

  /// Answers every fixture image with a server error, so Copy Image cannot fetch it. Registered after
  /// `ScrollMediaProtocol`, it is consulted first.
  private final nonisolated class FailingImageProtocol: URLProtocol, @unchecked Sendable {
    override static func canInit(with request: URLRequest) -> Bool {
      request.url?.host == "scroll-fixture.invalid"
    }

    override static func canonicalRequest(for request: URLRequest) -> URLRequest {
      request
    }

    override func startLoading() {
      guard let url = request.url, let response = HTTPURLResponse(url: url, statusCode: 500, httpVersion: nil, headerFields: nil) else { return }
      client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
      client?.urlProtocol(self, didLoad: Data("unavailable".utf8))
      client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
  }

  /// The 15b viewer fixture's helpers: hosting, opening, sheet capture and the green-region reader.
  private typealias Gallery = NativeWindowTests.MessageImageGalleryViewerTests

  /// Stands in for the system print panel: records each image handed to it, prints nothing.
  @MainActor private final class RecordingPrinter: ImagePrinting {
    private(set) var jobs: [(title: String, size: CGSize)] = []

    func print(_ image: NSImage, title: String) {
      jobs.append((title, image.size))
    }
  }

  extension NativeWindowTests {
    /// Row 15a2a: web's `ImageViewer` zoom (25 %–400 % in 25 % steps, reset to 100 %, the limit
    /// controls disabled, every image opening at 100 %) and Copy image (the image, else its link), in
    /// the same viewer sheet the message gallery (15b) and draft previews (14a2) open. The fixture
    /// images are the green SVGs of `MessageImageGalleryViewerTests`; zoom is read off the drawn
    /// width of the portrait image, which fits the image area by its height.
    @MainActor struct MessageImageViewerActionsTests {
      private static func imageURL(_ name: String, _ shape: GalleryShape, run: UUID) -> String {
        "https://scroll-fixture.invalid/\(run)/\(name).svg?format=svg&shape=\(shape.rawValue)"
      }

      private static func fixture(_ source: String, pasteboard: NSPasteboard.Name = .general, printer: RecordingPrinter = RecordingPrinter(),
                                  dark: Bool = false) -> GalleryFixture {
        let view = AnyView(MessageMarkdownView(source: source)
          .padding(12)
          .frame(width: 400, alignment: .leading)
          .background(.background)
          .environment(\.imageCopyPasteboard, pasteboard)
          .environment(\.imagePrinter, printer)
          .environmentObject(WorkspaceState()).environmentObject(AuthState())
          .environment(\.colorScheme, dark ? .dark : .light))
        let host = NSHostingView(rootView: view)
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 400, height: 1000), styleMask: [.titled, .resizable], backing: .buffered, defer: false)
        window.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        window.contentView = host
        window.orderFront(nil)
        return GalleryFixture(host: host, window: window)
      }

      /// A key equivalent where `NSApplication.sendEvent` offers it first; true when a control took it.
      private static func press(_ characters: String, keyCode: UInt16, modifiers: NSEvent.ModifierFlags = .command, in sheet: NSWindow) throws -> Bool {
        let event = try #require(NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: modifiers,
                                                  timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: sheet.windowNumber, context: nil,
                                                  characters: characters, charactersIgnoringModifiers: characters, isARepeat: false, keyCode: keyCode))
        return sheet.performKeyEquivalent(with: event)
      }

      private static func zoomIn(_ sheet: NSWindow) throws -> Bool {
        try press("=", keyCode: 24, in: sheet)
      }

      private static func zoomOut(_ sheet: NSWindow) throws -> Bool {
        try press("-", keyCode: 27, in: sheet)
      }

      private static func resetZoom(_ sheet: NSWindow) throws -> Bool {
        try press("0", keyCode: 29, in: sheet)
      }

      /// The drawn width, in pixels, of the tallest green region: the shown image.
      private static func shownWidth(_ sheet: NSWindow) throws -> Int? {
        try Gallery.greenBands(Gallery.sheetBitmap(sheet)).max { $0.rows.count < $1.rows.count }.map(\.columns.count)
      }

      /// Waits until the shown image is drawn at `scale` times `baseline`, within 4 %.
      private static func waitForScale(_ scale: Double, of baseline: Int, in sheet: NSWindow, _ message: String) async throws {
        var width: Int?
        for _ in 0 ..< 150 {
          width = try shownWidth(sheet)
          if let width, abs(Double(width) / Double(baseline) - scale) < 0.04 {
            return
          }
          try await Task.sleep(for: .milliseconds(20))
        }
        Issue.record("\(message) Drawn at \(width.map { Double($0) / Double(baseline) } ?? 0)×, expected \(scale)×.")
      }

      /// Opens the viewer on the image at `index` and returns the sheet and the shown image's width at 100 %.
      private static func open(_ index: Int, of count: Int, _ shape: GalleryShape, in fixture: GalleryFixture) async throws -> (NSWindow, Int) {
        try await Gallery.openImage(index, in: fixture, count: count)
        let sheet = try await Gallery.sheet(of: fixture)
        try await Gallery.waitForShape(shape, in: sheet, "The viewer opens on the clicked image.")
        try await Task.sleep(for: .milliseconds(200))
        let width = try shownWidth(sheet)
        return try (sheet, #require(width, "The viewer shows an image."))
      }

      /// Where a zoom control's centre sits, in bitmap pixels: a 140 × 44 pt capsule 16 pt above the
      /// bottom of the image area (which the sheet pads by 16 pt), three 36 pt controls 4 pt apart.
      private static func zoomControlPoint(_ offset: Int, in shot: NSBitmapImageRep, of sheet: NSWindow) throws -> CGPoint {
        let content = try #require(sheet.contentView)
        let scale = CGFloat(shot.pixelsWide) / content.bounds.width
        return CGPoint(x: (content.bounds.width / 2 + CGFloat(offset) * 40) * scale, y: (content.bounds.height - 16 - 16 - 22) * scale)
      }

      /// Web: Zoom in and out step by 25 % between 25 % and 400 %, each disabled at its limit; reset
      /// returns to 100 %. Apple adds ⌘=, ⌘− and ⌘0 as the controls' key equivalents.
      @Test func zoomStepsWithinWebsLimits() async throws {
        URLProtocol.registerClass(ScrollMediaProtocol.self)
        defer { URLProtocol.unregisterClass(ScrollMediaProtocol.self) }
        let fixture = Self.fixture("Only one: " + Gallery.link("b", .portrait, run: UUID()))
        defer { Gallery.close(fixture) }
        let (sheet, baseline) = try await Self.open(0, of: 1, .portrait, in: fixture)

        let content = try #require(sheet.contentView)
        let shot = try Gallery.sheetBitmap(sheet)
        try clickPixel(Self.zoomControlPoint(1, in: shot, of: sheet), of: shot, drawnFrom: content, in: sheet)
        try await Self.waitForScale(1.25, of: baseline, in: sheet, "Zoom in adds 25 %.")
        #expect(try Self.zoomIn(sheet), "⌘= is Zoom in's key.")
        try await Self.waitForScale(1.5, of: baseline, in: sheet, "⌘= zooms in.")
        #expect(try Self.press("+", keyCode: 24, modifiers: [.command, .shift], in: sheet), "⌘⇧= types + on a US layout.")
        try await Self.waitForScale(1.75, of: baseline, in: sheet, "⌘+ zooms in.")
        #expect(try Self.press("+", keyCode: 30, in: sheet), "+ has its own key on a German layout.")
        try await Self.waitForScale(2, of: baseline, in: sheet, "⌘+ without Shift zooms in.")
        #expect(try Self.resetZoom(sheet), "⌘0 is Reset zoom's key.")
        try await Self.waitForScale(1, of: baseline, in: sheet, "Reset returns to 100 %.")

        #expect(try Self.zoomOut(sheet), "⌘− is Zoom out's key.")
        try await Self.waitForScale(0.75, of: baseline, in: sheet, "Zoom out takes 25 % off.")
        #expect(try Self.zoomOut(sheet))
        #expect(try Self.zoomOut(sheet))
        try await Self.waitForScale(0.25, of: baseline, in: sheet, "Zoom out stops at 25 %.")
        #expect(try !Self.zoomOut(sheet), "Zoom out is disabled at 25 %.")
        #expect(try Self.resetZoom(sheet), "Reset stays enabled.")
        try await Self.waitForScale(1, of: baseline, in: sheet, "Reset from 25 %.")

        for step in 1 ... 12 {
          #expect(try Self.zoomIn(sheet), "Zoom in, step \(step) of 12.")
        }
        // The controls' enabled state follows the next render, as it would between real key presses.
        try await Task.sleep(for: .milliseconds(200))
        #expect(try !Self.zoomIn(sheet), "Zoom in is disabled at 400 %.")
        #expect(try !Self.press("+", keyCode: 24, modifiers: [.command, .shift], in: sheet), "So is ⌘+.")
        #expect(try Self.zoomOut(sheet), "Zoom out is enabled again below the maximum.")
      }

      /// Web keys the viewer's chrome by the image: a step, and reopening the viewer, show the image at 100 %.
      @Test func everyImageOpensAtActualSize() async throws {
        URLProtocol.registerClass(ScrollMediaProtocol.self)
        defer { URLProtocol.unregisterClass(ScrollMediaProtocol.self) }
        let fixture = Self.fixture(Gallery.threeImages(UUID()))
        defer { Gallery.close(fixture) }
        let (sheet, baseline) = try await Self.open(1, of: 3, .portrait, in: fixture)
        #expect(try Self.zoomIn(sheet))
        #expect(try Self.zoomIn(sheet))
        try await Self.waitForScale(1.5, of: baseline, in: sheet, "Zoomed before the step.")

        #expect(try Gallery.pressRight(in: sheet))
        try await Gallery.waitForShape(.wide, in: sheet, "→ steps to the next image.")
        #expect(try Gallery.pressLeft(in: sheet))
        try await Gallery.waitForShape(.portrait, in: sheet, "← steps back.")
        try await Self.waitForScale(1, of: baseline, in: sheet, "Back on the image, it is at 100 % again.")

        #expect(try Self.zoomIn(sheet))
        try await Self.waitForScale(1.25, of: baseline, in: sheet, "Zoomed before closing.")
        #expect(try Self.press("\u{1b}", keyCode: 53, modifiers: [], in: sheet), "Escape is Close's key.")
        for _ in 0 ..< 250 where fixture.window.attachedSheet != nil {
          try await Task.sleep(for: .milliseconds(20))
        }
        try #require(fixture.window.attachedSheet == nil, "The viewer closed.")
        let (reopened, width) = try await Self.open(1, of: 3, .portrait, in: fixture)
        #expect(abs(Double(width) / Double(baseline) - 1) < 0.04, "Reopened at \(Double(width) / Double(baseline))×.")
        #expect(try Self.zoomOut(reopened), "Reopened at 100 %, so Zoom out is available.")
      }

      /// Web's Copy image copies the image's bytes, else its URL. Apple writes the system image and
      /// the original bytes under their type; ⌘C is the control's key.
      @Test func copyImageCopiesTheImageElseItsLink() async throws {
        URLProtocol.registerClass(ScrollMediaProtocol.self)
        defer { URLProtocol.unregisterClass(ScrollMediaProtocol.self) }
        let pasteboard = NSPasteboard.withUniqueName()
        defer { pasteboard.releaseGlobally() }
        pasteboard.clearContents()
        let run = UUID()
        let fixture = Self.fixture("Only one: " + Gallery.link("b", .portrait, run: run), pasteboard: pasteboard.name)
        defer { Gallery.close(fixture) }
        let (sheet, _) = try await Self.open(0, of: 1, .portrait, in: fixture)

        var change = pasteboard.changeCount
        #expect(try Self.press("c", keyCode: 8, in: sheet), "⌘C is Copy Image's key.")
        for _ in 0 ..< 250 where pasteboard.changeCount == change {
          try await Task.sleep(for: .milliseconds(20))
        }
        let svg = pasteboard.data(forType: NSPasteboard.PasteboardType("public.svg-image")).flatMap { String(bytes: $0, encoding: .utf8) }
        #expect(svg?.contains("<svg") == true, "The original bytes under their type: \(pasteboard.types ?? []).")
        #expect(pasteboard.data(forType: .tiff) != nil, "The system image for apps that take no SVG.")
        #expect(pasteboard.string(forType: .string) == nil, "No link when the image itself was copied.")

        URLProtocol.registerClass(FailingImageProtocol.self)
        defer { URLProtocol.unregisterClass(FailingImageProtocol.self) }
        change = pasteboard.changeCount
        #expect(try Self.press("c", keyCode: 8, in: sheet))
        for _ in 0 ..< 250 where pasteboard.changeCount == change {
          try await Task.sleep(for: .milliseconds(20))
        }
        #expect(pasteboard.string(forType: .string) == Self.imageURL("b", .portrait, run: run), "The link when the image cannot be fetched.")
        #expect(pasteboard.data(forType: .tiff) == nil, "The earlier image is gone.")
      }

      private static func waitForJobs(_ count: Int, _ printer: RecordingPrinter) async throws {
        for _ in 0 ..< 250 where printer.jobs.count < count {
          try await Task.sleep(for: .milliseconds(20))
        }
        try #require(printer.jobs.count == count, "\(printer.jobs.count) of \(count) print jobs.")
      }

      /// Row 15a2b: web's Print prints the shown image by itself; ⌘P hands the image the viewer shows
      /// now, stepped to or not, to the printer, named by its file.
      @Test func printPrintsTheShownImage() async throws {
        URLProtocol.registerClass(ScrollMediaProtocol.self)
        defer { URLProtocol.unregisterClass(ScrollMediaProtocol.self) }
        let printer = RecordingPrinter()
        let fixture = Self.fixture(Gallery.threeImages(UUID()), printer: printer)
        defer { Gallery.close(fixture) }
        let (sheet, _) = try await Self.open(1, of: 3, .portrait, in: fixture)

        #expect(try Self.press("p", keyCode: 35, in: sheet), "⌘P is Print's key.")
        try await Self.waitForJobs(1, printer)
        let first = try #require(printer.jobs.last)
        #expect(first.title == "b.svg")
        #expect(first.size.height > first.size.width, "The portrait image: \(first.size)")

        #expect(try Gallery.pressRight(in: sheet))
        try await Gallery.waitForShape(.wide, in: sheet, "→ steps to the next image.")
        #expect(try Self.press("p", keyCode: 35, in: sheet))
        try await Self.waitForJobs(2, printer)
        let second = try #require(printer.jobs.last)
        #expect(second.title == "c.svg", "Print follows the stepped image.")
        #expect(second.size.width > 4 * second.size.height, "The wide image: \(second.size)")
      }

      /// Web prints silently or not at all; Apple says when the image cannot be downloaded to print.
      @Test func printReportsAnImageItCannotFetch() async throws {
        URLProtocol.registerClass(ScrollMediaProtocol.self)
        defer { URLProtocol.unregisterClass(ScrollMediaProtocol.self) }
        let printer = RecordingPrinter()
        let fixture = Self.fixture("Only one: " + Gallery.link("b", .portrait, run: UUID()), printer: printer)
        defer { Gallery.close(fixture) }
        let (sheet, _) = try await Self.open(0, of: 1, .portrait, in: fixture)

        URLProtocol.registerClass(FailingImageProtocol.self)
        defer { URLProtocol.unregisterClass(FailingImageProtocol.self) }
        #expect(try Self.press("p", keyCode: 35, in: sheet))
        for _ in 0 ..< 250 where sheet.attachedSheet == nil {
          try await Task.sleep(for: .milliseconds(20))
        }
        let alert = try #require(sheet.attachedSheet, "An alert says the image could not be printed.")
        sheet.endSheet(alert)
        #expect(printer.jobs.isEmpty, "Nothing reached the printer.")
      }

      /// Print and Copy Image belong to the image viewer only: the document viewer's bar, the same
      /// view, offers neither key.
      @Test func printAndCopyAreForImagesOnly() async throws {
        URLProtocol.registerClass(ScrollMediaProtocol.self)
        defer { URLProtocol.unregisterClass(ScrollMediaProtocol.self) }
        let printer = RecordingPrinter()
        let pasteboard = NSPasteboard.withUniqueName()
        defer { pasteboard.releaseGlobally() }
        let run = UUID()
        let pdfURL = try #require(URL(string: "https://scroll-fixture.invalid/\(run)/notes.pdf"))
        let imageURL = try #require(URL(string: Self.imageURL("b", .portrait, run: run)))
        let pdf = try #require(MessageAttachment(url: pdfURL, label: "notes.pdf"))
        let image = try #require(MessageAttachment(url: imageURL, label: "b.svg"))
        for (attachment, offersImageActions) in [(pdf, false), (image, true)] {
          let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 640, height: 60), styleMask: [.titled], backing: .buffered, defer: false)
          window.contentView = NSHostingView(rootView: AttachmentViewerToolbar(attachment: attachment, offersImageActions: offersImageActions) {}
            .padding()
            .environment(\.imagePrinter, printer)
            .environment(\.imageCopyPasteboard, pasteboard.name))
          window.orderFront(nil)
          defer { window.orderOut(nil) }
          try await Task.sleep(for: .milliseconds(100))
          #expect(try Self.press("p", keyCode: 35, in: window) == offersImageActions, "⌘P in the \(attachment.filename) viewer.")
          #expect(try Self.press("c", keyCode: 8, in: window) == offersImageActions, "⌘C in the \(attachment.filename) viewer.")
        }
        try await Self.waitForJobs(1, printer)
        #expect(printer.jobs.first?.title == "b.svg", "Only the image printed.")
      }

      /// The viewer with its zoom controls, Copy Image and Print, light and dark, over the sheet's own background.
      @Test(arguments: [false, true])
      func rendersTheZoomControls(dark: Bool) async throws {
        URLProtocol.registerClass(ScrollMediaProtocol.self)
        defer { URLProtocol.unregisterClass(ScrollMediaProtocol.self) }
        let fixture = Self.fixture(Gallery.threeImages(UUID()), dark: dark)
        defer { Gallery.close(fixture) }
        try await Gallery.openImage(1, in: fixture, count: 3)
        let sheet = try await Gallery.sheet(of: fixture)
        sheet.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        try await Gallery.waitForShape(.portrait, in: sheet, "The viewer opens on the clicked image.")
        try await Task.sleep(for: .milliseconds(300))
        let shot = try Gallery.sheetBitmap(sheet)
        try Attachment.record(#require(shot.representation(using: .png, properties: [:])), named: "image-viewer-actions-\(dark ? "dark" : "light").png")
        let corner = try #require(shot.colorAt(x: 2, y: shot.pixelsHigh - 2)?.usingColorSpace(.deviceRGB))
        #expect(corner.alphaComponent == 1, "Drawn over the sheet's background: alpha \(corner.alphaComponent)")
        // The capsule's scrim darkens the image beside each glyph; the glyphs themselves are white.
        let scale = CGFloat(shot.pixelsWide) / (sheet.contentView?.bounds.width ?? 1)
        for offset in [-1, 0, 1] {
          let point = try Self.zoomControlPoint(offset, in: shot, of: sheet)
          let beside = try #require(shot.colorAt(x: Int(point.x + 14 * scale), y: Int(point.y))?.usingColorSpace(.deviceRGB))
          #expect(!Gallery.isFixtureGreen(shot, Int(point.x + 14 * scale), Int(point.y)), "Control \(offset) sits on a scrim: \(beside)")
          #expect(beside.brightnessComponent < 0.6, "The scrim is dark: \(beside.brightnessComponent)")
        }
        guard let lines = try RoomThreadOverviewGroupsViewTests.recognizedText(in: shot) else { return }
        #expect(lines.contains { $0.text.replacingOccurrences(of: " ", with: "").contains("b.svg") }, "The file name: \(lines.map(\.text))")
      }
    }
  }
#endif

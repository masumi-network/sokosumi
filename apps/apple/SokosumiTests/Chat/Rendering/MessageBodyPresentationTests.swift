#if os(macOS)
  import AppKit
  import CoreAPI
  @testable import Sokosumi
  import SokosumiAuth
  import SokosumiChat
  import SokosumiWorkspace
  import SwiftUI
  import Testing
  import Vision

  extension NativeWindowTests {
    /// Row 10c: a long body clamps at 16 lines with Show more / Show less, a file attachment included
    /// (web exempts only a large solo image), and a fenced block shows no language label, as on web.
    @MainActor struct MessageBodyPresentationTests {
      private static let width: CGFloat = 480
      private static let inset: CGFloat = 16
      private static let longText = (1 ... 30).map { "Line \($0) of a very long chat message." }.joined(separator: "\n")
      private static let fileLink = "[report.pdf](https://example.com/report.pdf)"
      private static let code = """
      func greet(name: String) -> String {
        let count = 3 // three times
        return String(repeating: "Hello, \\(name)! ", count: count)
      }
      """

      @Test(arguments: [false, true])
      func aLongMessageWithAFileOffersShowMoreAndExpands(dark: Bool) async throws {
        let source = Self.longText + "\n\n" + Self.fileLink
        let fixture = try Self.fixture(source: source, dark: dark)
        defer { fixture.window.orderOut(nil) }
        let collapsed = try await Self.settledHeight(fixture)
        let natural = Self.naturalHeight(of: source, dark: dark)
        let lines16 = Self.collapsedLinesHeight()
        let showMore = Self.buttonSize("Show more")
        #expect(collapsed < natural, "The body must be clamped: \(collapsed) pt rendered, \(natural) pt unclamped.")
        #expect(collapsed <= lines16 + 4 + showMore.height + 2 * Self.inset + 1, "At most 16 lines plus the control.")
        #expect(collapsed >= lines16 * 0.75 + showMore.height + 2 * Self.inset, "Whole lines up to the sixteenth stay visible.")
        let collapsedBitmap = try Self.record(fixture.host, named: "message-body-file-collapsed-\(dark ? "dark" : "light").png")
        if let lines = try Self.recognizedText(in: collapsedBitmap) {
          let read = lines.map(\.text)
          #expect(read.contains { $0.contains("Show more") }, "OCR read: \(read)")
          #expect(!read.contains { $0.contains("Show less") }, "OCR read: \(read)")
          #expect(!read.contains { $0.contains("Line 17") }, "The seventeenth line is below the fold; OCR read: \(read)")
        }

        try Self.click(control: "Show more", in: fixture, bitmap: collapsedBitmap)
        let expanded = try await Self.settledHeight(fixture, after: collapsed)
        #expect(expanded >= natural + 4 + showMore.height + 2 * Self.inset - 1, "Expanded shows the whole body and the control: \(expanded) pt.")
        let expandedBitmap = try Self.record(fixture.host, named: "message-body-file-expanded-\(dark ? "dark" : "light").png")
        if let lines = try Self.recognizedText(in: expandedBitmap) {
          let read = lines.map(\.text)
          #expect(read.contains { $0.contains("Show less") }, "OCR read: \(read)")
          // The file tile draws an icon; its name is the tooltip, so OCR cannot read it. The natural height above covers the tile.
          #expect(read.contains { $0.contains("Line 30") }, "OCR read: \(read)")
        }

        try Self.click(control: "Show less", in: fixture, bitmap: expandedBitmap)
        let collapsedAgain = try await Self.settledHeight(fixture, after: expanded)
        #expect(abs(collapsedAgain - collapsed) <= 1, "Show less returns to the clamped height: \(collapsedAgain) vs \(collapsed).")
      }

      @Test func aLongMessageWithASoloImageIsNotClamped() async throws {
        URLProtocol.registerClass(ScrollMediaProtocol.self)
        defer { URLProtocol.unregisterClass(ScrollMediaProtocol.self) }
        let fixture = try Self.fixture(source: Self.longText + "\n\n[photo.png](https://scroll-fixture.invalid/photo.png)", dark: false)
        defer { fixture.window.orderOut(nil) }
        let height = try await Self.settledHeight(fixture)
        let textAlone = Self.naturalHeight(of: Self.longText, dark: false)
        #expect(height >= textAlone + 2 * Self.inset - 1, "Thirty lines and the image are all shown: \(height) pt, text alone \(textAlone) pt.")
        if let lines = try Self.recognizedText(in: Self.bitmap(fixture.host)) {
          let read = lines.map(\.text)
          #expect(!read.contains { $0.contains("Show more") }, "OCR read: \(read)")
          #expect(read.contains { $0.contains("Line 30") }, "OCR read: \(read)")
        }
      }

      @Test func aShortMessageOffersNoShowMore() async throws {
        let fixture = try Self.fixture(source: "Short message", dark: false)
        defer { fixture.window.orderOut(nil) }
        let height = try await Self.settledHeight(fixture)
        let natural = Self.naturalHeight(of: "Short message", dark: false)
        #expect(abs(height - (natural + 2 * Self.inset)) <= 1, "No control under a body that does not overflow: \(height) vs \(natural).")
        if let lines = try Self.recognizedText(in: Self.bitmap(fixture.host)) {
          let read = lines.map(\.text)
          #expect(!read.contains { $0.contains("Show more") }, "OCR read: \(read)")
        }
      }

      /// The fence's language picks the grammar; nothing is printed above the code, and it is highlighted.
      @Test(arguments: [false, true])
      func aFencedBlockShowsNoLanguageLabelAndKeepsItsHighlighting(dark: Bool) async throws {
        let labelled = Self.codeBlockHeight(languageHint: "swift", dark: dark)
        let unlabelled = Self.codeBlockHeight(languageHint: nil, dark: dark)
        #expect(abs(labelled - unlabelled) <= 0.5, "A language hint adds nothing above the code: \(labelled) vs \(unlabelled) pt.")

        let fixture = try Self.fixture(source: "Here is the code:\n\n```swift\n" + Self.code + "\n```", dark: dark)
        defer { fixture.window.orderOut(nil) }
        _ = try await Self.settledHeight(fixture)
        _ = try await waitForView(in: fixture.host, timeoutMessage: "The block was not highlighted") {
          ((try? Self.coloredPixels(in: Self.bitmap(fixture.host))) ?? 0) > 0 ? fixture.host : nil
        }
        let bitmap = try Self.record(fixture.host, named: "message-code-block-\(dark ? "dark" : "light").png")
        #expect(try Self.coloredPixels(in: bitmap) > 0, "Keywords and strings are coloured.")
        if let lines = try Self.recognizedText(in: bitmap) {
          let read = lines.map(\.text)
          #expect(!read.contains { $0.trimmingCharacters(in: .whitespaces).lowercased() == "swift" }, "OCR read: \(read)")
          #expect(read.contains { $0.contains("Here is the code") }, "OCR read: \(read)")
          #expect(read.contains { $0.contains("func greet") }, "OCR read: \(read)")
        }
      }

      // MARK: - Fixture

      /// The real `MessageMarkdownView`, as the row hosts it, at a fixed width with an inset all round.
      private static func fixture(source: String, dark: Bool) throws -> BodyFixture {
        let session = URLSession(configuration: .ephemeral)
        let client = try Client.connecting(to: #require(URL(string: "https://body-fixture.invalid/v1")), session: session)
        let workspaces = WorkspaceState(clientProvider: { _ in client })
        let content = MessageMarkdownView(source: source)
          .environmentObject(workspaces)
          .environmentObject(AuthState())
          .padding(inset)
          .frame(width: width, alignment: .topLeading)
          .background(.background)
          .environment(\.colorScheme, dark ? .dark : .light)
        let host = NSHostingView(rootView: AnyView(content))
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: width, height: 200), styleMask: [.titled], backing: .buffered, defer: false)
        window.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        window.contentView = host
        window.makeKeyAndOrderFront(nil)
        return BodyFixture(window: window, host: host)
      }

      /// The rendered height once the Markdown is prepared (no spinner left), any image has loaded and the
      /// layout has stopped changing; with `after`, once it has left that height first. The window is fitted to it.
      private static func settledHeight(_ fixture: BodyFixture, after previous: CGFloat? = nil) async throws -> CGFloat {
        var stable = 0
        var last: CGFloat = -1
        _ = try await waitForView(in: fixture.host, timeoutMessage: "The body did not settle; last height \(last)") {
          let height = fixture.host.fittingSize.height
          if let previous, abs(height - previous) <= 1 {
            stable = 0
            last = height
            return nil
          }
          stable = abs(height - last) <= 0.5 ? stable + 1 : 0
          last = height
          return stable >= 5 && height > 2 * inset + 8 && !showsSpinner(fixture.host) ? fixture.host : nil
        }
        fixture.window.setContentSize(NSSize(width: width, height: last))
        fixture.host.frame = NSRect(origin: .zero, size: NSSize(width: width, height: last))
        fixture.host.layoutSubtreeIfNeeded()
        return last
      }

      /// `ProgressView` is an `NSProgressIndicator` on macOS: the body's while it parses, the image's while it loads.
      private static func showsSpinner(_ view: NSView) -> Bool {
        view is NSProgressIndicator || view.subviews.contains(where: showsSpinner)
      }

      /// The same blocks without the clamp, at the body's width.
      private static func naturalHeight(of source: String, dark: Bool) -> CGFloat {
        NSHostingView(rootView: MarkdownBlocksView(blocks: MessageMarkdown(source).blocks)
          .frame(width: width - 2 * inset, alignment: .topLeading)
          .environment(\.colorScheme, dark ? .dark : .light)).fittingSize.height
      }

      /// Sixteen lines of body text, as `ExpandableMessageBody` measures its collapsed height.
      private static func collapsedLinesHeight() -> CGFloat {
        NSHostingView(rootView: Text(String(repeating: "A\n", count: 15) + "A").font(.body).fixedSize()).fittingSize.height
      }

      private static func buttonSize(_ title: String) -> CGSize {
        NSHostingView(rootView: Button(title) {}.buttonStyle(.borderless).font(.caption.weight(.medium))).fittingSize
      }

      private static func codeBlockHeight(languageHint: String?, dark: Bool) -> CGFloat {
        NSHostingView(rootView: MessageCodeBlock(source: code, languageHint: languageHint)
          .frame(width: width - 2 * inset, alignment: .topLeading)
          .environment(\.colorScheme, dark ? .dark : .light)).fittingSize.height
      }

      /// Clicks the expansion control where `ExpandableMessageBody` lays it out: leading, under the body,
      /// so its centre is half its own size in from the inset. Where Vision runs, the OCR box confirms it.
      private static func click(control title: String, in fixture: BodyFixture, bitmap: NSBitmapImageRep) throws {
        let size = buttonSize(title)
        let point = NSPoint(x: inset + size.width / 2, y: inset + size.height / 2)
        if let lines = try recognizedText(in: bitmap), let control = lines.first(where: { $0.text.contains(title) }) {
          let box = control.box
          let normalized = CGPoint(x: point.x / fixture.host.bounds.width, y: point.y / fixture.host.bounds.height)
          #expect(box.insetBy(dx: -0.02, dy: -0.01).contains(normalized), "\(title) is drawn at \(box), the click lands at \(normalized).")
        }
        for type in [NSEvent.EventType.leftMouseDown, .leftMouseUp] {
          guard let event = NSEvent.mouseEvent(with: type, location: point, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
                                               windowNumber: fixture.window.windowNumber, context: nil, eventNumber: 0, clickCount: 1, pressure: 1) else { continue }
          fixture.window.sendEvent(event)
        }
      }

      private static func bitmap(_ view: NSView) throws -> NSBitmapImageRep {
        let bitmap = try #require(view.bitmapImageRepForCachingDisplay(in: view.bounds))
        view.cacheDisplay(in: view.bounds, to: bitmap)
        return bitmap
      }

      /// Recorded on the result bundle, which the app sandbox cannot hide: `xcresulttool export attachments`.
      private static func record(_ view: NSView, named name: String) throws -> NSBitmapImageRep {
        let bitmap = try bitmap(view)
        try Attachment.record(#require(bitmap.representation(using: .png, properties: [:])), named: name)
        return bitmap
      }

      /// Pixels whose channels differ enough to be a colour: plain text and chrome are grey in both appearances.
      private static func coloredPixels(in bitmap: NSBitmapImageRep) throws -> Int {
        var count = 0
        for row in stride(from: 0, to: bitmap.pixelsHigh, by: 2) {
          for column in stride(from: 0, to: bitmap.pixelsWide, by: 2) {
            guard let color = bitmap.colorAt(x: column, y: row)?.usingColorSpace(.sRGB) else { continue }
            let channels = [color.redComponent, color.greenComponent, color.blueComponent]
            if let high = channels.max(), let low = channels.min(), high - low > 0.25 {
              count += 1
            }
          }
        }
        return count
      }

      /// Vision's lines with their boxes, or nil where Vision cannot run at all (the virtualized CI runner).
      private static func recognizedText(in bitmap: NSBitmapImageRep) throws -> [(text: String, box: CGRect)]? {
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

  private struct BodyFixture {
    let window: NSWindow
    let host: NSHostingView<AnyView>
  }
#endif

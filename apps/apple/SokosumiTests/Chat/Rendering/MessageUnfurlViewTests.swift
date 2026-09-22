#if os(macOS)
  import AppKit
  import CoreAPI
  @testable import Sokosumi
  import SwiftUI
  import Testing
  import Vision

  @MainActor struct MessageUnfurlViewTests {
    @Test(arguments: [false, true])
    func previewCardsFitNarrowLayouts(dark: Bool) async throws {
      let content = VStack(alignment: .leading, spacing: 12) {
        MessageUnfurlView(preview: .init(url: "https://example.com", title: "A useful article about building native applications", description: "A short preview with enough text to verify wrapping and spacing at a narrow window width.", siteName: "Example"), remove: {})
        MessageUnfurlView(preview: .init(url: "https://example.com/second", title: "Another link", description: "Read-only preview."))
      }
      .padding(20).frame(width: 340).background(.background)
      .environment(\.colorScheme, dark ? .dark : .light)
      let host = NSHostingView(rootView: content)
      host.frame = NSRect(x: 0, y: 0, width: 340, height: 300)
      for _ in 0 ..< 10 {
        host.layoutSubtreeIfNeeded()
        try await Task.sleep(for: .milliseconds(20))
      }
      #expect(host.fittingSize.height < 300)
    }
  }

  extension NativeWindowTests {
    /// Row 22a: a card renders when Core gave it an image URL or a description, and a card whose
    /// image then fails to load drops to its text (site name, title, description) as on web.
    @MainActor struct MessageUnfurlFallbackTests {
      private static let cardWidth: CGFloat = 400
      /// Site name, title and card padding; anything above this still holds the image budget.
      private static let textOnlyCeiling: CGFloat = 100

      @Test func aCardWhoseImageFailsKeepsItsSiteNameAndTitle() async throws {
        URLProtocol.registerClass(ScrollMediaProtocol.self)
        defer { URLProtocol.unregisterClass(ScrollMediaProtocol.self) }
        let host = Self.host(Self.card(description: nil, imageUrl: Self.failingImageURL()))
        let window = Self.window(host, dark: false)
        defer { window.orderOut(nil) }
        host.layoutSubtreeIfNeeded()
        #expect(host.fittingSize.height >= 200, "Loading reserves the image budget under the title.")
        try await Self.waitForTextOnly(host)
        #expect(host.fittingSize.height > 0)
        let bitmap = try Self.bitmap(host)
        #expect(!Self.containsFixtureImage(bitmap), "The failed image must not stay in the card.")
        #expect(Self.drawsSomething(bitmap), "The card's text must be drawn.")
        if let lines = try Self.recognizedLines(in: bitmap) {
          #expect(lines.contains { $0.localizedCaseInsensitiveContains("Native link previews") }, "OCR read: \(lines)")
          #expect(!lines.contains { $0.localizedCaseInsensitiveContains("Preview unavailable") }, "OCR read: \(lines)")
        }
      }

      @Test func aCardWhoseImageFailsKeepsItsDescription() async throws {
        URLProtocol.registerClass(ScrollMediaProtocol.self)
        defer { URLProtocol.unregisterClass(ScrollMediaProtocol.self) }
        let withDescription = Self.host(Self.card(description: "A short summary of the page.", imageUrl: Self.failingImageURL()))
        let withoutDescription = Self.host(Self.card(description: nil, imageUrl: Self.failingImageURL()))
        let window = Self.window(withDescription, dark: false)
        defer { window.orderOut(nil) }
        let second = Self.window(withoutDescription, dark: false)
        defer { second.orderOut(nil) }
        try await Self.waitForTextOnly(withDescription)
        try await Self.waitForTextOnly(withoutDescription)
        // The description is one caption line; the card keeps it after the image goes.
        #expect(withDescription.fittingSize.height > withoutDescription.fittingSize.height + 8)
        #expect(try !Self.containsFixtureImage(Self.bitmap(withDescription)))
      }

      @Test func aCardWithoutAnImageRendersItsText() {
        let host = Self.host(Self.card(description: "A short summary of the page.", imageUrl: nil))
        host.layoutSubtreeIfNeeded()
        #expect(host.fittingSize.height > 0)
        #expect(host.fittingSize.height < Self.textOnlyCeiling, "No image budget is reserved without an image URL.")
      }

      @Test(arguments: [(nil as String?, nil as String?), ("  ", "  ")])
      func aTitleOnlyCardStaysHidden(imageUrl: String?, description: String?) {
        let host = Self.host(Self.card(description: description, imageUrl: imageUrl))
        host.layoutSubtreeIfNeeded()
        #expect(host.fittingSize.height == 0, "Web filters title-only cards through unfurlCardHasPreviewContent.")
      }

      @Test func theRemoveControlAndTheLinkStayOnTheTextOnlyCard() async throws {
        URLProtocol.registerClass(ScrollMediaProtocol.self)
        defer { URLProtocol.unregisterClass(ScrollMediaProtocol.self) }
        let plain = Self.host(Self.card(description: nil, imageUrl: Self.failingImageURL()))
        let removable = Self.host(Self.card(description: nil, imageUrl: Self.failingImageURL(), remove: {}))
        let window = Self.window(plain, dark: false)
        defer { window.orderOut(nil) }
        let second = Self.window(removable, dark: false)
        defer { second.orderOut(nil) }
        try await Self.waitForTextOnly(plain)
        try await Self.waitForTextOnly(removable)
        // The remove control hangs over the card's top-trailing corner; the card makes 8 points of room
        // for it above (the width is the fixed host frame either way).
        #expect(abs(removable.fittingSize.height - plain.fittingSize.height - 8) <= 1)
        // The card is the link; without a destination there is nothing to open, so nothing renders.
        let unlinked = Self.host(Self.card(url: "", description: "A short summary of the page.", imageUrl: nil))
        unlinked.layoutSubtreeIfNeeded()
        #expect(unlinked.fittingSize.height == 0)
      }

      /// A card with a loaded image above the same kind of card whose image failed, light and dark.
      @Test(arguments: [false, true])
      func textOnlyCardBesideAnImageCard(dark: Bool) async throws {
        URLProtocol.registerClass(ScrollMediaProtocol.self)
        defer { URLProtocol.unregisterClass(ScrollMediaProtocol.self) }
        let scheme: ColorScheme = dark ? .dark : .light
        let imageCard = Self.host(Self.card(title: "A useful article about building native applications", description: "A short preview with enough text to verify wrapping and spacing.", imageUrl: Self.loadingImageURL(), remove: {}), scheme: scheme)
        let textCard = Self.host(Self.card(description: nil, imageUrl: Self.failingImageURL(), remove: {}), scheme: scheme)
        let stack = NSStackView(views: [imageCard, textCard])
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 12
        stack.edgeInsets = NSEdgeInsets(top: 20, left: 20, bottom: 20, right: 20)
        stack.wantsLayer = true
        let window = Self.window(stack, dark: dark)
        defer { window.orderOut(nil) }
        // Resolve the dynamic colour under the window's appearance, not the test process's.
        window.appearance?.performAsCurrentDrawingAppearance {
          stack.layer?.backgroundColor = NSColor.windowBackgroundColor.cgColor
        }
        try await Self.waitForImage(imageCard)
        try await Self.waitForTextOnly(textCard)
        window.setContentSize(stack.fittingSize)
        stack.layoutSubtreeIfNeeded()

        #expect(imageCard.fittingSize.height > 200, "The image card shows its image.")
        #expect(textCard.fittingSize.height > 0)
        #expect(textCard.fittingSize.height < Self.textOnlyCeiling + 8, "The text-only card has no image box.")
        #expect(try Self.containsFixtureImage(Self.bitmap(imageCard)))
        let textBitmap = try Self.bitmap(textCard)
        #expect(!Self.containsFixtureImage(textBitmap))
        #expect(Self.drawsSomething(textBitmap))
        if let lines = try Self.recognizedLines(in: textBitmap) {
          #expect(lines.contains { $0.localizedCaseInsensitiveContains("Native link previews") }, "OCR read: \(lines)")
          #expect(!lines.contains { $0.localizedCaseInsensitiveContains("Preview unavailable") }, "OCR read: \(lines)")
        }
        try Self.record(stack, named: "unfurl-text-fallback-\(dark ? "dark" : "light").png")
      }

      // MARK: - Fixture pieces

      private static func card(url: String = "https://example.com/article", title: String = "Native link previews", description: String?, imageUrl: String?, remove: (() async throws -> Void)? = nil) -> MessageUnfurlView {
        MessageUnfurlView(preview: .init(url: url, title: title, description: description, imageUrl: imageUrl, siteName: "Example"), remove: remove)
      }

      private static func failingImageURL() -> String {
        "https://scroll-fixture.invalid/\(UUID()).png?failure"
      }

      private static func loadingImageURL() -> String {
        "https://scroll-fixture.invalid/\(UUID()).png"
      }

      private static func host(_ card: MessageUnfurlView, scheme: ColorScheme = .light) -> NSHostingView<some View> {
        let host = NSHostingView(rootView: card.frame(width: cardWidth, alignment: .leading).background(.background).environment(\.colorScheme, scheme))
        host.translatesAutoresizingMaskIntoConstraints = false
        return host
      }

      private static func window(_ content: NSView, dark: Bool) -> NSWindow {
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: cardWidth + 40, height: 500), styleMask: [.titled], backing: .buffered, defer: false)
        window.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        window.contentView = content
        window.orderFront(nil)
        return window
      }

      private static func waitForTextOnly(_ host: NSView) async throws {
        _ = try await waitForView(in: host, timeoutMessage: "The failed image never dropped out of the card (fitting: \(host.fittingSize)).") {
          host.fittingSize.height < textOnlyCeiling + 8 ? host : nil
        }
      }

      private static func waitForImage(_ host: NSView) async throws {
        _ = try await waitForView(in: host, timeoutMessage: "The fixture image never rendered (fitting: \(host.fittingSize)).") {
          (try? containsFixtureImage(bitmap(host))) == true ? host : nil
        }
      }

      private static func bitmap(_ view: NSView) throws -> NSBitmapImageRep {
        view.layoutSubtreeIfNeeded()
        let bitmap = try #require(view.bitmapImageRepForCachingDisplay(in: view.bounds))
        view.cacheDisplay(in: view.bounds, to: bitmap)
        return bitmap
      }

      /// Saturated green is the fixture image and nothing else in the card.
      private static func containsFixtureImage(_ bitmap: NSBitmapImageRep) -> Bool {
        for row in stride(from: 0, to: bitmap.pixelsHigh, by: 4) {
          for column in stride(from: 0, to: bitmap.pixelsWide, by: 4) {
            if let color = bitmap.colorAt(x: column, y: row),
               color.greenComponent > 0.7, color.blueComponent < 0.35,
               color.redComponent < 0.6, color.alphaComponent > 0.9 {
              return true
            }
          }
        }
        return false
      }

      /// True when the render is not one flat colour.
      private static func drawsSomething(_ bitmap: NSBitmapImageRep) -> Bool {
        guard let first = bitmap.colorAt(x: 0, y: 0) else { return false }
        for row in stride(from: 0, to: bitmap.pixelsHigh, by: 2) {
          for column in stride(from: 0, to: bitmap.pixelsWide, by: 2) {
            if let color = bitmap.colorAt(x: column, y: row),
               abs(color.redComponent - first.redComponent) > 0.2 || abs(color.greenComponent - first.greenComponent) > 0.2 || abs(color.blueComponent - first.blueComponent) > 0.2 {
              return true
            }
          }
        }
        return false
      }

      /// The text Vision reads in the render, or nil where Vision cannot run at all (the virtualized CI runner).
      private static func recognizedLines(in bitmap: NSBitmapImageRep) throws -> [String]? {
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
        return (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }
      }

      /// Recorded on the result bundle, which the app sandbox cannot hide: `xcresulttool export attachments`.
      private static func record(_ view: NSView, named name: String) throws {
        let bitmap = try bitmap(view)
        try Attachment.record(#require(bitmap.representation(using: .png, properties: [:])), named: name)
      }
    }
  }
#endif

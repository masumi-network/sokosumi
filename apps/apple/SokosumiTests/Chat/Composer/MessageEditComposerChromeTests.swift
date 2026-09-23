#if os(macOS)
  import AppKit
  import CoreAPI
  @testable import Sokosumi
  import SokosumiChat
  import Testing
  import Vision

  extension NativeWindowTests {
    /// Row 18b: web's inline `MessageEditComposer` draws no Save or Cancel button (the keys from 18a save and
    /// cancel), shows "Too long to send as text" and the `count/max` count on one line under the field, keeps
    /// editing on Return over the limit, and dims the field while a save is in flight.
    @MainActor struct MessageEditComposerChromeTests {
      private static let edited = "Updated **release notes** for the team."
      private static let overLimit = String(repeating: "a", count: ComposerContent.maximumLength + 1) + "  "

      @Test(arguments: [false, true])
      func drawsNoSaveCancelOrSendButton(dark: Bool) async throws {
        // The render doubles as PARITY's fixture image; show the formatting bar in both appearances.
        let toolbarWasVisible = ComposerPreferences().toolbarVisible
        ComposerPreferences().toolbarVisible = true
        defer { ComposerPreferences().toolbarVisible = toolbarWasVisible }
        let fixture = try await MessageEditComposerFixture.make(dark: dark)
        defer { fixture.window.orderOut(nil) }
        fixture.editing.draft = Self.edited
        try await fixture.waitForDraft(Self.edited)
        let bitmap = try Self.record(fixture, named: "message-editing-\(dark ? "dark" : "light").png")
        // SwiftUI draws its buttons without an `NSButton`, and a window that is not key draws a prominent
        // button grey, so the check reads ink: under the field, right of the formatting and emoji controls,
        // where Cancel and Save (or Send) stood, the composer is blank.
        let field = Self.pixelRect(of: fixture.input.enclosingScrollView ?? fixture.input, in: fixture.host, bitmap: bitmap)
        let scale = CGFloat(bitmap.pixelsWide) / fixture.host.bounds.width
        let actions = CGRect(x: field.midX, y: field.maxY, width: field.maxX - field.midX, height: CGFloat(bitmap.pixelsHigh) - field.maxY - 24 * scale)
        let ink = try Self.inkPixels(in: bitmap, rect: actions)
        #expect(ink == 0, "\(ink) drawn pixels right of the formatting controls in \(actions): a button is drawn.")
        if let lines = try Self.recognizedText(in: bitmap)?.map(\.text) {
          #expect(lines.contains { $0.contains("release notes") }, "OCR read: \(lines)")
          #expect(!lines.contains { $0 == "Save" || $0 == "Cancel" || $0.contains("Cancel Save") }, "OCR read: \(lines)")
        }
      }

      @Test(arguments: [false, true])
      func anOverLimitDraftShowsTheHintAndCountOnOneLineUnderTheField(dark: Bool) async throws {
        let fixture = try await MessageEditComposerFixture.make(dark: dark)
        defer { fixture.window.orderOut(nil) }
        fixture.editing.draft = Self.overLimit
        try await fixture.waitForDraft(Self.overLimit)
        let bitmap = try Self.record(fixture, named: "message-edit-over-limit-\(dark ? "dark" : "light").png")
        guard let read = try Self.recognizedText(in: bitmap) else { return }
        let lines = read.map(\.text)
        #expect(!lines.contains { $0.contains("exceeds") }, "OCR read: \(lines)")
        let hint = try #require(read.first { $0.text.contains("Too long to send as text") }, "OCR read: \(lines)")
        // The count is measured on the trimmed draft, as web's `trimmedEditContent`.
        let count = try #require(read.first { $0.text.contains("10001/10000") }, "OCR read: \(lines)")
        #expect(abs(hint.box.midY - count.box.midY) < hint.box.height, "Hint \(hint.box) and count \(count.box) share a line.")
        #expect(count.box.minX > hint.box.maxX, "The count sits to the right of the hint.")
        let field = Self.pixelRect(of: fixture.input.enclosingScrollView ?? fixture.input, in: fixture.host, bitmap: bitmap)
        #expect(hint.box.minY > field.maxY, "The hint \(hint.box) sits under the field \(field).")
      }

      @Test func returnOnAnOverLimitDraftKeepsEditing() async throws {
        let fixture = try await MessageEditComposerFixture.make()
        defer { fixture.window.orderOut(nil) }
        fixture.editing.draft = Self.overLimit
        try await fixture.waitForDraft(Self.overLimit)
        let text = fixture.input.string
        fixture.input.setSelectedRange(NSRange(location: text.utf16.count, length: 0))
        try fixture.input.keyDown(with: MessageEditComposerFixture.returnEvent())
        #expect(fixture.editing.source != nil, "Still editing.")
        #expect(!fixture.editing.isSaving, "Nothing was sent.")
        #expect(fixture.input.string == text, "Return added no line.")
      }

      @Test func aSaveInFlightDimsTheField() async throws {
        let fixture = try await MessageEditComposerFixture.make()
        defer { fixture.window.orderOut(nil) }
        fixture.editing.draft = "Changed"
        try await fixture.waitForDraft("Changed")
        let idle = try Self.darkestTextLuminance(fixture)
        #expect(idle < 0.25, "The idle draft reads as dark text (\(idle)).")

        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [HeldEditProtocol.self]
        let client = try Client.connecting(to: #require(URL(string: "https://edit-fixture.invalid/v1")),
                                           session: URLSession(configuration: configuration))
        let editing = fixture.editing
        let save = Task { _ = try? await editing.save(client: client, organizationSlug: nil) }
        defer { save.cancel() }

        let clock = ContinuousClock()
        let deadline = clock.now.advanced(by: .seconds(5))
        var saving = idle
        repeat {
          try await Task.sleep(for: .milliseconds(20))
          guard editing.isSaving else { continue }
          saving = try Self.darkestTextLuminance(fixture)
        } while saving < 0.35 && clock.now < deadline
        #expect(editing.isSaving, "The save is still in flight.")
        #expect(saving >= 0.35, "The text dims while saving, as web's opacity-50 (idle \(idle), saving \(saving)).")
        #expect(!fixture.input.isEditable, "The field takes no typing while saving.")
      }

      /// Pixels in `rect` that differ from its top-left pixel, the composer's background.
      private static func inkPixels(in bitmap: NSBitmapImageRep, rect: CGRect) throws -> Int {
        let background = try #require(bitmap.colorAt(x: Int(rect.minX), y: Int(rect.minY))?.usingColorSpace(.sRGB))
        var count = 0
        for row in Int(rect.minY) ..< Int(rect.maxY) {
          for column in Int(rect.minX) ..< Int(rect.maxX) {
            guard let color = bitmap.colorAt(x: column, y: row)?.usingColorSpace(.sRGB) else { continue }
            let difference = max(abs(color.redComponent - background.redComponent),
                                 abs(color.greenComponent - background.greenComponent),
                                 abs(color.blueComponent - background.blueComponent))
            if difference > 0.08 {
              count += 1
            }
          }
        }
        return count
      }

      /// The darkest pixel inside the text view, light appearance: black text idle, grey once dimmed.
      private static func darkestTextLuminance(_ fixture: MessageEditComposerFixture) throws -> CGFloat {
        let bitmap = try bitmap(fixture)
        let rect = pixelRect(of: fixture.input.enclosingScrollView ?? fixture.input, in: fixture.host, bitmap: bitmap)
        var darkest: CGFloat = 1
        for row in stride(from: Int(rect.minY), to: Int(rect.maxY), by: 1) {
          for column in stride(from: Int(rect.minX), to: Int(rect.maxX), by: 1) {
            guard let color = bitmap.colorAt(x: column, y: row)?.usingColorSpace(.sRGB) else { continue }
            darkest = min(darkest, 0.2126 * color.redComponent + 0.7152 * color.greenComponent + 0.0722 * color.blueComponent)
          }
        }
        return darkest
      }

      /// A view's frame in the bitmap's pixels, origin top left.
      private static func pixelRect(of view: NSView, in host: NSView, bitmap: NSBitmapImageRep) -> CGRect {
        var rect = view.convert(view.bounds, to: host)
        if !host.isFlipped {
          rect.origin.y = host.bounds.height - rect.maxY
        }
        let scale = CGFloat(bitmap.pixelsWide) / host.bounds.width
        return CGRect(x: rect.minX * scale, y: rect.minY * scale, width: rect.width * scale, height: rect.height * scale)
          .intersection(CGRect(x: 0, y: 0, width: bitmap.pixelsWide, height: bitmap.pixelsHigh))
      }

      private static func bitmap(_ fixture: MessageEditComposerFixture) throws -> NSBitmapImageRep {
        let host = fixture.host
        fixture.window.setContentSize(host.fittingSize)
        host.layoutSubtreeIfNeeded()
        let bitmap = try #require(host.bitmapImageRepForCachingDisplay(in: host.bounds))
        host.cacheDisplay(in: host.bounds, to: bitmap)
        return bitmap
      }

      /// Recorded on the result bundle, which the app sandbox cannot hide: `xcresulttool export attachments`.
      private static func record(_ fixture: MessageEditComposerFixture, named name: String) throws -> NSBitmapImageRep {
        let bitmap = try bitmap(fixture)
        try Attachment.record(#require(bitmap.representation(using: .png, properties: [:])), named: name)
        return bitmap
      }

      /// Vision's lines with their boxes in the bitmap's pixels (origin top left), or nil where Vision cannot
      /// run at all (the virtualized CI runner).
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
        let width = CGFloat(bitmap.pixelsWide)
        let height = CGFloat(bitmap.pixelsHigh)
        return (request.results ?? []).compactMap { observation in
          observation.topCandidates(1).first.map { candidate in
            let box = observation.boundingBox
            return (candidate.string, CGRect(x: box.minX * width, y: (1 - box.maxY) * height, width: box.width * width, height: box.height * height))
          }
        }
      }
    }
  }

  /// Never answers, so a save stays in flight until the test cancels it.
  private final nonisolated class HeldEditProtocol: URLProtocol, @unchecked Sendable {
    override static func canInit(with request: URLRequest) -> Bool {
      request.url?.host == "edit-fixture.invalid"
    }

    override static func canonicalRequest(for request: URLRequest) -> URLRequest {
      request
    }

    override func startLoading() {}

    override func stopLoading() {}
  }
#endif

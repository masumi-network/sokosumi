#if os(macOS)
  import AppKit
  import CoreAPI
  @testable import Sokosumi
  import SokosumiChat
  import Testing
  import Vision

  extension NativeWindowTests {
    /// Row 18b: no Save/Cancel row under the edit field (web has none; Apple keeps compact controls beside the
    /// field, see `MessageEditComposerControlsTests`), "Too long to send as text" and the `count/max` count on
    /// one line under the field, editing kept on Return over the limit, and the field dimmed while saving.
    @MainActor struct MessageEditComposerChromeTests {
      private static let edited = "Updated **release notes** for the team."
      private static let overLimit = String(repeating: "a", count: ComposerContent.maximumLength + 1) + "  "

      @Test func drawsNoButtonRowUnderTheField() async throws {
        let fixture = try await MessageEditComposerFixture.make(dark: false)
        defer { fixture.window.orderOut(nil) }
        fixture.editing.draft = Self.edited
        try await fixture.waitForDraft(Self.edited)
        let bitmap = try fixture.bitmap()
        // Under the field, right of the formatting and emoji controls, where Cancel and Save (or Send)
        // stood, the composer is blank.
        let field = fixture.fieldRect(in: bitmap)
        let scale = fixture.scale(of: bitmap)
        let actions = CGRect(x: field.midX, y: field.maxY, width: field.maxX - field.midX, height: CGFloat(bitmap.pixelsHigh) - field.maxY - 24 * scale)
        let ink = try Self.inkPixels(in: bitmap, rect: actions)
        #expect(ink == 0, "\(ink) drawn pixels right of the formatting controls in \(actions): a button is drawn.")
        if let lines = try Self.recognizedText(in: bitmap)?.map(\.text) {
          #expect(lines.contains { $0.contains("release notes") }, "OCR read: \(lines)")
          #expect(!lines.contains { $0.contains("Save") || $0.contains("Cancel") }, "OCR read: \(lines)")
        }
      }

      @Test func anOverLimitDraftShowsTheHintAndCountOnOneLineUnderTheField() async throws {
        let fixture = try await MessageEditComposerFixture.make(dark: false)
        defer { fixture.window.orderOut(nil) }
        fixture.editing.draft = Self.overLimit
        try await fixture.waitForDraft(Self.overLimit)
        let bitmap = try fixture.record(named: "message-edit-over-limit.png")
        guard let read = try Self.recognizedText(in: bitmap) else { return }
        let lines = read.map(\.text)
        #expect(!lines.contains { $0.contains("exceeds") }, "OCR read: \(lines)")
        let hint = try #require(read.first { $0.text.contains("Too long to send as text") }, "OCR read: \(lines)")
        // The count is measured on the trimmed draft, as web's `trimmedEditContent`.
        let count = try #require(read.first { $0.text.contains("10001/10000") }, "OCR read: \(lines)")
        #expect(abs(hint.box.midY - count.box.midY) < hint.box.height, "Hint \(hint.box) and count \(count.box) share a line.")
        #expect(count.box.minX > hint.box.maxX, "The count sits to the right of the hint.")
        #expect(hint.box.minY > fixture.fieldRect(in: bitmap).maxY, "The hint \(hint.box) sits under the field.")
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

        let client = try MessageEditComposerFixture.heldClient()
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
        let bitmap = try fixture.bitmap()
        let rect = fixture.fieldRect(in: bitmap)
        var darkest: CGFloat = 1
        for row in Int(rect.minY) ..< Int(rect.maxY) {
          for column in Int(rect.minX) ..< Int(rect.maxX) {
            guard let color = bitmap.colorAt(x: column, y: row)?.usingColorSpace(.sRGB) else { continue }
            darkest = min(darkest, 0.2126 * color.redComponent + 0.7152 * color.greenComponent + 0.0722 * color.blueComponent)
          }
        }
        return darkest
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
#endif

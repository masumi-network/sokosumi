#if os(macOS)
  import AppKit
  @testable import Sokosumi
  import SokosumiChat
  import SwiftUI
  import Testing
  import Vision

  /// The states web's single handle line takes besides its help, each replacing the help rather than stacking.
  enum CreateChannelHandleLine: CaseIterable, Sendable {
    case checking, taken, failed, invalid

    /// The line Vision must read, as it appears in the render.
    var fragment: String {
      switch self {
      case .checking: "Checking handle"
      case .taken: "This channel handle already exists"
      case .failed: "Could not check this handle"
      case .invalid: "Enter a valid handle."
      }
    }

    var status: ChannelCreation.HandleStatus {
      switch self {
      case .checking: .checking
      case .taken: .taken
      case .failed: .failed
      case .invalid: .invalid
      }
    }
  }

  extension NativeWindowTests {
    /// Web's create-channel field guidance: handle and name help, remaining-character counters for name and topic,
    /// and the member count in the participants choice.
    @MainActor struct CreateChannelGuidanceTests {
      static let name = "Launch planning with design, research and the partner teams in Europe"
      static let topic = "Weekly launch planning with design and AI research partners. Share drafts, decisions and open questions here so everyone can follow along without digging through old threads."

      private let roster = ChannelRoster(recipients: .init(targets: [
        .init(id: .human("me"), name: "Alex Morgan", detail: "alex@example.com"),
        .init(id: .human("peer"), name: "Sam Rivera", detail: "sam@example.com"),
        .init(id: .coworker("agent"), name: "Research assistant", detail: "Research and analysis"),
        .init(id: .sokoBot("bot"), name: "Personal assistant")
      ]), isOwnerOrAdmin: true)

      @Test(arguments: [false, true])
      func detailsShowHelpAndNearLimitCounters(dark: Bool) async throws {
        let model = try await loadedModel()
        model.draft.setName(Self.name)
        model.draft.setTopic(Self.topic)
        let (host, window) = mount(model, dark: dark)
        defer { window.orderOut(nil) }
        try await waitForLoad(model, in: host)
        let bitmap = try await render(host, in: window, expecting: ["Unique among channels", "Shown in the sidebar", "\(80 - Self.name.utf16.count)", "\(200 - Self.topic.utf16.count)"])
        try Self.expectWindowBackground(bitmap, dark: dark)
        try Attachment.record(#require(bitmap.representation(using: .png, properties: [:])), named: "create-channel-guidance-\(dark ? "dark" : "light").png")
      }

      @Test(arguments: [false, true])
      func participantsNameTheMemberCount(dark: Bool) async throws {
        let model = try await loadedModel()
        model.advance()
        let (host, window) = mount(model, dark: dark)
        defer { window.orderOut(nil) }
        try await waitForLoad(model, in: host)
        let bitmap = try await render(host, in: window, expecting: ["Add all 2 members of Acme", "Select people and"])
        try Self.expectWindowBackground(bitmap, dark: dark)
        try Attachment.record(#require(bitmap.representation(using: .png, properties: [:])), named: "create-channel-participants-\(dark ? "dark" : "light").png")
      }

      /// Drives the sheet's own slug check (`.task(id:)` through `checkSlug`) into each state and reads the line it draws.
      @Test(arguments: CreateChannelHandleLine.allCases, [false, true])
      func handleLineReplacesItsHelp(line: CreateChannelHandleLine, dark: Bool) async throws {
        let model = try await loadedModel()
        if line == .invalid {
          model.draft.setSlug("...")
        }
        let (host, window) = mount(model, dark: dark) { _ in
          switch line {
          case .checking:
            try await Task.sleep(for: .seconds(60))
            return true
          case .taken: return false
          case .failed: throw URLError(.timedOut)
          case .invalid: return true
          }
        }
        defer { window.orderOut(nil) }
        try await waitForLoad(model, in: host)
        let bitmap = try await render(host, in: window, expecting: [line.fragment] + (line == .failed ? ["Retry"] : []), absent: ["Unique among channels"])
        #expect(model.handleStatus == line.status)
        try Self.expectWindowBackground(bitmap, dark: dark)
      }

      /// Web's `maxLength` stops typing at the limit; the field must not keep characters the draft dropped.
      @Test func typingPastTheNameLimitStopsAtTheLimit() async throws {
        let model = try await loadedModel()
        let start = String(repeating: "n", count: ChannelDraft.nameLimit - 2)
        model.draft.setName(start)
        let (host, window) = mount(model, dark: false)
        defer { window.orderOut(nil) }
        try await waitForLoad(model, in: host)
        let field = try await waitForView(in: host, timeoutMessage: "The name field never mounted") {
          Self.textField(in: host) { $0.stringValue == start }
        }
        #expect(window.makeFirstResponder(field))
        let editor = try #require(field.currentEditor() as? NSTextView)
        editor.setSelectedRange(NSRange(location: (start as NSString).length, length: 0))
        editor.insertText("xyz", replacementRange: editor.selectedRange())
        let limited = start + "xy"
        _ = try await waitForView(in: host, timeoutMessage: "The typed name never reached the draft (\(model.draft.name.count))") {
          model.draft.name == limited ? field : nil
        }
        #expect(model.draft.remainingNameCharacters == 0)
        #expect(field.stringValue == limited)
      }

      /// The sheet loads the roster itself on mount; draw only once that load settled.
      private func waitForLoad(_ model: ChannelCreation, in host: NSView) async throws {
        _ = try await waitForView(in: host, timeoutMessage: "The roster load never settled") {
          model.loading || model.roster == nil ? nil : host
        }
      }

      private func loadedModel() async throws -> ChannelCreation {
        let model = ChannelCreation()
        await model.load { roster }
        model.draft.setSlug("launch-planning")
        await model.checkSlug { _ in true }
        #expect(model.availability == .free)
        return model
      }

      private func mount(_ model: ChannelCreation, dark: Bool,
                         checkSlug: @escaping (String) async throws -> Bool = { _ in true }) -> (NSHostingView<some View>, NSWindow) {
        let roster = roster
        let content = CreateChannelView(currentUserId: "me", organizationName: "Acme", model: model,
                                        load: { roster }, checkSlug: checkSlug, create: { _, _ in
                                          Issue.record("Rendering must not create a channel")
                                          return false
                                        })
                                        .environment(\.colorScheme, dark ? .dark : .light)
        let host = NSHostingView(rootView: content)
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 480, height: 640), styleMask: [.titled], backing: .buffered, defer: false)
        window.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        window.contentView = host
        window.orderFront(nil)
        return (host, window)
      }

      /// Draws until Vision reads every expected fragment; on a runner without Vision the text claims are skipped.
      private func render(_ host: NSView, in window: NSWindow, expecting fragments: [String], absent: [String] = []) async throws -> NSBitmapImageRep {
        var drawn: NSBitmapImageRep?
        var lastLines: [String] = []
        let clock = ContinuousClock()
        let deadline = clock.now.advanced(by: .seconds(10))
        repeat {
          let bitmap = try Self.overWindowBackground(fittedBitmap(of: host, in: window), appearance: window.effectiveAppearance)
          guard let lines = try Self.recognizedLines(in: bitmap) else { return bitmap }
          lastLines = lines
          let text = lines.joined(separator: "\n")
          if fragments.allSatisfy({ fragment in lines.contains { $0.contains(fragment) } || text.contains(fragment) }),
             !absent.contains(where: { text.contains($0) }) {
            drawn = bitmap
            break
          }
          try await Task.sleep(for: .milliseconds(50))
        } while clock.now < deadline
        return try #require(drawn, "Expected \(fragments) without \(absent) in the render; Vision read \(lastLines)")
      }

      /// The sheet's backdrop is window chrome that `cacheDisplay` does not draw, so the content is drawn over the
      /// window background in the window's appearance (as `MessageImageGalleryViewerTests.sheetBitmap` does).
      private static func overWindowBackground(_ drawn: NSBitmapImageRep, appearance: NSAppearance) throws -> NSBitmapImageRep {
        let opaque = try #require(NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: drawn.pixelsWide, pixelsHigh: drawn.pixelsHigh,
                                                   bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                                                   colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0))
        let bounds = NSRect(x: 0, y: 0, width: drawn.pixelsWide, height: drawn.pixelsHigh)
        NSGraphicsContext.saveGraphicsState()
        defer { NSGraphicsContext.restoreGraphicsState() }
        NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: opaque)
        appearance.performAsCurrentDrawingAppearance {
          NSColor.windowBackgroundColor.setFill()
          bounds.fill()
        }
        drawn.draw(in: bounds, from: .zero, operation: .sourceOver, fraction: 1, respectFlipped: false, hints: nil)
        return opaque
      }

      private static func expectWindowBackground(_ bitmap: NSBitmapImageRep, dark: Bool) throws {
        let corner = try #require(bitmap.colorAt(x: 2, y: 2)?.usingColorSpace(.deviceRGB))
        #expect(corner.alphaComponent == 1, "Hosted over the window background: alpha \(corner.alphaComponent)")
        #expect(dark ? corner.brightnessComponent < 0.5 : corner.brightnessComponent > 0.5)
      }

      private static func textField(in view: NSView, where matches: (NSTextField) -> Bool) -> NSTextField? {
        if let field = view as? NSTextField, field.isEditable, matches(field) {
          return field
        }
        for subview in view.subviews {
          if let field = textField(in: subview, where: matches) {
            return field
          }
        }
        return nil
      }

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
    }
  }
#endif

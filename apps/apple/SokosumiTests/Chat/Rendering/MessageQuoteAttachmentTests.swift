#if os(macOS)
  import AppKit
  import CoreAPI
  @testable import Sokosumi
  import SokosumiAuth
  import SokosumiChat
  import SokosumiWorkspace
  import SwiftUI
  import Testing

  /// The window fixture and sheet readers of the 15b viewer tests.
  private typealias Gallery = NativeWindowTests.MessageImageGalleryViewerTests
  /// The accessibility-node reader of the result card tests.
  private typealias Results = NativeWindowTests.SokoBotResultPreviewsTests

  extension NativeWindowTests {
    /// Web's quote draws every attachment as a wrapping row of 40 pt tiles, in the transcript and the composer preview.
    @MainActor struct MessageQuoteAttachmentTests {
      private static let names = ["one.png", "two.png", "three.png", "four.png"]
      private static let roomId = "550e8400-e29b-41d4-a716-446655440041"
      private static let quote = Components.Schemas.ChatRoomMessageQuote(
        messageId: "source", authorName: "Ben", snippet: "",
        attachments: names.map { .init(fileName: $0, url: "https://scroll-fixture.invalid/quote/\($0)", mediaKind: .image) }
      )

      @Test func theTranscriptDrawsEveryImageOfAQuote() async throws {
        try await expectTiles(quotingRow(Self.quote) { _ in nil }, size: NSSize(width: 520, height: 220), named: "quote-transcript-four-images")
      }

      @Test func theComposerPreviewDrawsEveryImageOfAQuote() async throws {
        try await expectTiles(composer(quoting: Self.quote), size: NSSize(width: 560, height: 280), named: "quote-composer-four-images")
      }

      /// A tile is the same size loaded or not, so the second row shows in the fitting height.
      @Test func aNarrowQuoteWrapsItsRow() {
        func height(width: CGFloat) -> CGFloat {
          NSHostingView(rootView: MessageQuoteView(quote: Self.quote).frame(width: width)).fittingSize.height
        }
        #expect(abs(height(width: 130) - height(width: 420) - 44) < 1)
      }

      /// A file has no image to crop: it shows its type, and hover and VoiceOver keep its name.
      @Test func aFileShowsItsTypeAndKeepsItsNameForVoiceOver() async throws {
        let quote = Components.Schemas.ChatRoomMessageQuote(
          messageId: "source", authorName: "Ben", snippet: "see and",
          attachments: [.init(fileName: "notes.pdf", url: "https://example.com/notes.pdf", mediaKind: .file),
                        .init(fileName: "budget.xlsx", url: "https://example.com/budget.xlsx", mediaKind: .file)]
        )
        let appearances = try await ChatCopyAlignmentTests.lightAndDark(named: "quote-file-tiles") { dark in
          try await ChatCopyAlignmentTests.render(MessageQuoteView(quote: quote).padding(12), size: NSSize(width: 300, height: 120), dark: dark)
        }
        for texts in appearances {
          #expect(texts.contains("notes.pdf"), "\(texts)")
          #expect(texts.contains("budget.xlsx"), "\(texts)")
        }
      }

      /// Web's transcript tile sits inside the quote's jump button.
      @Test func aClickOnATranscriptTileJumpsToTheSource() async throws {
        URLProtocol.registerClass(ScrollMediaProtocol.self)
        defer { URLProtocol.unregisterClass(ScrollMediaProtocol.self) }
        var jumps: [String] = []
        let fixture = window(quotingRow(Self.oneImage) { action in
          if case let .jumpToQuote(id) = action {
            jumps.append(id)
          }
          return nil
        })
        defer { Gallery.close(fixture) }
        try await clickEdge(of: "one.png", in: fixture)
        for _ in 0 ..< 100 where jumps.isEmpty {
          try await Task.sleep(for: .milliseconds(20))
        }
        #expect(jumps == ["source"])
        #expect(fixture.window.attachedSheet == nil, "The transcript's tile jumps; it does not open the viewer.")
      }

      /// A quote sent to yourself from another room follows its message link, as web's jump button does.
      @Test func aClickOnATileOfAQuoteFromAnotherRoomFollowsItsLink() async throws {
        URLProtocol.registerClass(ScrollMediaProtocol.self)
        defer { URLProtocol.unregisterClass(ScrollMediaProtocol.self) }
        var quote = Self.oneImage
        quote.roomId = "room_2"
        var opened: [URL] = []
        var jumps = 0
        let row = quotingRow(quote) { _ in
          jumps += 1
          return nil
        }
        .environment(\.openURL, OpenURLAction { opened.append($0)
          return .handled
        })
        let fixture = window(row)
        defer { Gallery.close(fixture) }
        try await clickEdge(of: "one.png", in: fixture)
        for _ in 0 ..< 100 where opened.isEmpty {
          try await Task.sleep(for: .milliseconds(20))
        }
        #expect(opened == [quoteSourceURL(quote, inRoom: "room_1", webBaseURL: CoreSettings.webBaseURL)].compactMap(\.self))
        #expect(jumps == 0)
      }

      /// Web's composer tile is `FileChipMiniPreview`: an image opens its viewer.
      @Test func aClickOnAComposerImageTileOpensTheViewer() async throws {
        URLProtocol.registerClass(ScrollMediaProtocol.self)
        defer { URLProtocol.unregisterClass(ScrollMediaProtocol.self) }
        let fixture = window(composer(quoting: Self.oneImage))
        defer { Gallery.close(fixture) }
        try await clickEdge(of: "one.png", in: fixture)
        let sheet = try await Gallery.sheet(of: fixture)
        var drawn = try Gallery.sheetBitmap(sheet)
        for _ in 0 ..< 250 where Gallery.greenBands(drawn).isEmpty {
          try await Task.sleep(for: .milliseconds(20))
          drawn = try Gallery.sheetBitmap(sheet)
        }
        #expect(!Gallery.greenBands(drawn).isEmpty, "The viewer draws the quoted image.")
        let content = try #require(sheet.contentView)
        let texts = await hostedTexts(in: content)
        #expect(texts.contains("one.png"), "\(texts)")
        try Attachment.record(#require(drawn.representation(using: .png, properties: [:])), named: "quote-composer-image-viewer.png")
      }

      /// A document opens the document viewer. The click lands on the tile's edge, outside the type icon, because a
      /// plain button takes only what it draws unless it names its shape.
      @Test func aClickOnAComposerDocumentTileOpensTheDocumentViewer() async throws {
        var opened: [URL] = []
        let fixture = window(composer(quoting: Self.file("notes.pdf"), opened: { opened.append($0) }))
        defer { Gallery.close(fixture) }
        try await clickEdge(of: "notes.pdf", in: fixture)
        let sheet = try await Gallery.sheet(of: fixture)
        let content = try #require(sheet.contentView)
        var texts = await hostedTexts(in: content)
        for _ in 0 ..< 100 where !texts.contains("Close") {
          try await Task.sleep(for: .milliseconds(20))
          texts = await hostedTexts(in: content)
        }
        #expect(texts.contains("notes.pdf"), "\(texts)")
        #expect(texts.contains("Close"), "\(texts)")
        #expect(opened.isEmpty)
        try Attachment.record(#require(Gallery.sheetBitmap(sheet).representation(using: .png, properties: [:])), named: "quote-composer-document-viewer.png")
      }

      /// Web has no viewer for an archive, a video or a sound, so its tile is a link.
      @Test(arguments: ["bundle.zip", "clip.mp4", "memo.mp3"])
      func aClickOnAComposerFileWithNoViewerOpensItsLink(name: String) async throws {
        var opened: [URL] = []
        let fixture = window(composer(quoting: Self.file(name), opened: { opened.append($0) }))
        defer { Gallery.close(fixture) }
        try await clickEdge(of: name, in: fixture)
        for _ in 0 ..< 100 where opened.isEmpty {
          try await Task.sleep(for: .milliseconds(20))
        }
        #expect(opened == [URL(string: "https://scroll-fixture.invalid/quote/\(name)")].compactMap(\.self))
        #expect(fixture.window.attachedSheet == nil)
      }

      /// VoiceOver finds the tile by its file name, hears what it does and presses it as a click would.
      @Test func voiceOverPressesATile() async throws {
        var jumps: [String] = []
        let transcript = window(quotingRow(Self.file("notes.pdf")) { action in
          if case let .jumpToQuote(id) = action {
            jumps.append(id)
          }
          return nil
        })
        defer { Gallery.close(transcript) }
        let tile = try #require(await Results.nodes(labelled: "notes.pdf", in: transcript.host).first)
        #expect(tile.object.value(forKey: "accessibilityHelp") as? String == "Go to quoted message")
        #expect(tile.press())
        #expect(jumps == ["source"])

        let composing = window(composer(quoting: Self.file("notes.pdf")))
        defer { Gallery.close(composing) }
        let document = try #require(await Results.nodes(labelled: "notes.pdf", in: composing.host).first)
        #expect(document.object.value(forKey: "accessibilityHelp") as? String == "Preview")
        #expect(document.press())
        _ = try await Gallery.sheet(of: composing)

        var opened: [URL] = []
        let linking = window(composer(quoting: Self.file("bundle.zip"), opened: { opened.append($0) }))
        defer { Gallery.close(linking) }
        let link = try #require(await Results.nodes(labelled: "bundle.zip", in: linking.host).first)
        #expect(link.object.value(forKey: "accessibilityHelp") as? String == "Open in Browser")
      }

      /// A link that is not a web address has nothing to preview, as a draft's tile without one does, and the app
      /// must not hand another message's scheme to the system.
      @Test func aComposerTileWithNoWebAddressStaysInert() async throws {
        var opened: [URL] = []
        let quote = Components.Schemas.ChatRoomMessageQuote(
          messageId: "source", authorName: "Ben", snippet: "",
          attachments: [.init(fileName: "notes.pdf", url: "file:///etc/notes.pdf", mediaKind: .file)]
        )
        let fixture = window(composer(quoting: quote, opened: { opened.append($0) }))
        defer { Gallery.close(fixture) }
        try await clickEdge(of: "notes.pdf", in: fixture)
        try await Task.sleep(for: .milliseconds(300))
        #expect(opened.isEmpty)
        #expect(fixture.window.attachedSheet == nil)
      }

      private static let oneImage = Components.Schemas.ChatRoomMessageQuote(
        messageId: "source", authorName: "Ben", snippet: "",
        attachments: [.init(fileName: "one.png", url: "https://scroll-fixture.invalid/quote/one.png", mediaKind: .image)]
      )

      private static func file(_ name: String) -> Components.Schemas.ChatRoomMessageQuote {
        .init(messageId: "source", authorName: "Ben", snippet: "",
              attachments: [.init(fileName: name, url: "https://scroll-fixture.invalid/quote/\(name)", mediaKind: .file)])
      }

      /// The real transcript row of a message that quotes `quote`.
      private func quotingRow(_ quote: Components.Schemas.ChatRoomMessageQuote,
                              perform: @escaping (MessageRowAction) -> Task<Void, any Error>?) -> some View {
        var message = chatRoomMessage(from: .init(clientTurnId: "turn", roomId: "room_1", content: "Agreed",
                                                  createdAt: Date(),
                                                  sender: .init(id: "user", name: "Ada", email: "ada@example.com", presence: .online)))
        message.id = "message_1"
        message.quote = quote
        let workspaces = WorkspaceState()
        return MessageRowView(message: message, row: transcriptRow(message, viewerId: "user"), outbound: nil,
                              perform: perform, isPinned: false, editing: workspaces.openRoom.messageEditing)
          .padding(16)
          .frame(maxHeight: .infinity, alignment: .topLeading)
          .environmentObject(workspaces).environmentObject(AuthState())
      }

      /// The real composer with `quote` pending.
      private func composer(quoting quote: Components.Schemas.ChatRoomMessageQuote, opened: @escaping (URL) -> Void = { _ in }) -> some View {
        let userId = UUID().uuidString
        return ChatComposerView(userId: userId, draftScope: .init(organizationId: nil), roomId: Self.roomId, pendingQuote: .constant(quote))
          .frame(maxHeight: .infinity, alignment: .topLeading)
          .environmentObject(WorkspaceState()).environmentObject(AuthState())
          .environmentObject(ComposeUploads(savedDraft: SavedComposeDraft(userId: userId, organizationId: nil, roomId: Self.roomId)))
          .environmentObject(ComposerAttachmentIngress())
          .environment(\.openURL, OpenURLAction { opened($0)
            return .handled
          })
      }

      /// A window that takes clicks and attaches sheets.
      private func window(_ content: some View) -> GalleryFixture {
        let size = NSSize(width: 560, height: 320)
        let host = NSHostingView(rootView: AnyView(content.frame(width: size.width, height: size.height).background(.background)))
        let window = NSWindow(contentRect: NSRect(origin: .zero, size: size), styleMask: [.titled], backing: .buffered, defer: false)
        window.contentView = host
        window.orderFront(nil)
        return GalleryFixture(host: host, window: window)
      }

      /// Clicks the tile named `name` at the middle of its bottom edge.
      private func clickEdge(of name: String, in fixture: GalleryFixture) async throws {
        let tile = try #require(await Results.nodes(labelled: name, in: fixture.host).first)
        let frame = try #require(tile.object.value(forKey: "accessibilityFrame") as? NSRect)
        let location = fixture.window.convertPoint(fromScreen: CGPoint(x: frame.midX, y: frame.minY + 2))
        for type in [NSEvent.EventType.leftMouseDown, .leftMouseUp] {
          let event = try #require(NSEvent.mouseEvent(with: type, location: location, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
                                                      windowNumber: fixture.window.windowNumber, context: nil, eventNumber: 0, clickCount: 1, pressure: 1))
          fixture.window.sendEvent(event)
        }
      }

      /// `content` in light and dark, once its tiles' images have drawn. The fixture's image is green and a tile that
      /// has not loaded is not, so the separate green runs across the columns count the drawn tiles.
      private func expectTiles(_ content: some View, size: NSSize, named name: String) async throws {
        URLProtocol.registerClass(ScrollMediaProtocol.self)
        defer { URLProtocol.unregisterClass(ScrollMediaProtocol.self) }
        var shots: [[CGImage]] = []
        for dark in [false, true] {
          let host = NSHostingView(rootView: content
            .frame(width: size.width, height: size.height)
            .background(.background)
            .environment(\.colorScheme, dark ? .dark : .light))
          let window = NSWindow(contentRect: NSRect(origin: .zero, size: size), styleMask: [.titled], backing: .buffered, defer: false)
          window.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
          window.ignoresMouseEvents = true
          window.contentView = host
          window.orderFront(nil)
          defer { window.orderOut(nil) }
          var shot = try bitmap(host)
          for _ in 0 ..< 200 where greenRuns(shot) < Self.names.count {
            try await Task.sleep(for: .milliseconds(50))
            shot = try bitmap(host)
          }
          #expect(greenRuns(shot) == Self.names.count)
          let texts = await hostedTexts(in: host)
          for fileName in Self.names {
            #expect(texts.contains(fileName), "\(texts)")
          }
          try shots.append([#require(shot.cgImage)])
        }
        try Attachment.record(#require(RoomHeaderTests.stitched(shots).representation(using: .png, properties: [:])), named: "\(name).png")
      }

      private func bitmap(_ host: NSView) throws -> NSBitmapImageRep {
        host.layoutSubtreeIfNeeded()
        let bitmap = try #require(host.bitmapImageRepForCachingDisplay(in: host.bounds))
        host.cacheDisplay(in: host.bounds, to: bitmap)
        return bitmap
      }

      private func greenRuns(_ bitmap: NSBitmapImageRep) -> Int {
        var pixel = [Int](repeating: 0, count: max(bitmap.samplesPerPixel, 4))
        let top = Double((1 << bitmap.bitsPerSample) - 1)
        var runs = 0
        var inRun = false
        for column in stride(from: 0, to: bitmap.pixelsWide, by: 2) {
          let green = stride(from: 0, to: bitmap.pixelsHigh, by: 3).contains { row in
            bitmap.getPixel(&pixel, atX: column, y: row)
            return Double(pixel[1]) / top > 0.7 && Double(pixel[2]) / top < 0.35
          }
          if green, !inRun {
            runs += 1
          }
          inRun = green
        }
        return runs
      }
    }
  }
#endif

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
    /// Web's quote draws every attachment as a wrapping row of 40 pt tiles, in the transcript and the composer preview.
    @MainActor struct MessageQuoteAttachmentTests {
      private static let names = ["one.png", "two.png", "three.png", "four.png"]
      private static let roomId = "550e8400-e29b-41d4-a716-446655440041"
      private static let quote = Components.Schemas.ChatRoomMessageQuote(
        messageId: "source", authorName: "Ben", snippet: "",
        attachments: names.map { .init(fileName: $0, url: "https://scroll-fixture.invalid/quote/\($0)", mediaKind: .image) }
      )

      @Test func theTranscriptDrawsEveryImageOfAQuote() async throws {
        var message = chatRoomMessage(from: .init(clientTurnId: "turn", roomId: "room_1", content: "Agreed",
                                                  createdAt: Date(),
                                                  sender: .init(id: "user", name: "Ada", email: "ada@example.com", presence: .online)))
        message.id = "message_1"
        message.quote = Self.quote
        let workspaces = WorkspaceState()
        let row = MessageRowView(message: message, row: transcriptRow(message, viewerId: "user"), outbound: nil,
                                 perform: { _ in nil }, isPinned: false, editing: workspaces.openRoom.messageEditing)
          .padding(16)
          .frame(maxHeight: .infinity, alignment: .topLeading)
          .environmentObject(workspaces).environmentObject(AuthState())
        try await expectTiles(row, size: NSSize(width: 520, height: 220), named: "quote-transcript-four-images")
      }

      @Test func theComposerPreviewDrawsEveryImageOfAQuote() async throws {
        let userId = UUID().uuidString
        let composer = ChatComposerView(userId: userId, draftScope: .init(organizationId: nil), roomId: Self.roomId, pendingQuote: .constant(Self.quote))
          .frame(maxHeight: .infinity, alignment: .topLeading)
          .environmentObject(WorkspaceState()).environmentObject(AuthState())
          .environmentObject(ComposeUploads(savedDraft: SavedComposeDraft(userId: userId, organizationId: nil, roomId: Self.roomId)))
          .environmentObject(ComposerAttachmentIngress())
        try await expectTiles(composer, size: NSSize(width: 560, height: 280), named: "quote-composer-four-images")
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

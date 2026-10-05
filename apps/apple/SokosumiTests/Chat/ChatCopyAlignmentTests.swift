#if os(macOS)
  import AppKit
  import CoreAPI
  import HTTPTypes
  import OpenAPIRuntime
  @testable import Sokosumi
  import SokosumiAuth
  import SokosumiChat
  import SokosumiWorkspace
  import SwiftUI
  import Testing
  import Vision

  extension NativeWindowTests {
    /// Row 41: the chat's own words follow web's catalogue (`apps/web/messages/en.json`). Each view is the real one,
    /// hosted over the window background in light and dark; Vision reads the words on a local run only (the CI runner
    /// returns nil), so there the renders and the pixel checks carry the test.
    @MainActor struct ChatCopyAlignmentTests {
      private static let created = Date(timeIntervalSince1970: 1_790_000_000)
      private static let roomId = "550e8400-e29b-41d4-a716-446655440041"

      private static func channel(members: [Components.Schemas.ChatRoomUserParticipant] = []) -> Components.Schemas.ChatRoom {
        .init(
          id: roomId, name: "launch", kind: .channel, isSelfDirect: false, isGroupDirect: false, isReadOnly: false,
          discoverability: .external, createdByUserId: "me", createdAt: created, updatedAt: created, unreadCount: 0,
          unreadMentionCount: 0, markedUnread: false, myAccess: .init(value1: .member, value2: "member"),
          userMembers: members, formerUserMembers: [], coworkerMembers: [], sokoBotMembers: []
        )
      }

      /// `content` in a window of `size`, drawn after its layout settles; the window background shows through nowhere.
      private static func render(_ content: some View, size: NSSize, dark: Bool, settle: Int = 10) async throws -> NSBitmapImageRep {
        let host = NSHostingView(rootView: content
          .frame(width: size.width, height: size.height)
          .background(.background)
          .environment(\.locale, Locale(identifier: "en_US"))
          .environment(\.colorScheme, dark ? .dark : .light))
        let window = NSWindow(contentRect: NSRect(origin: .zero, size: size), styleMask: [.titled], backing: .buffered, defer: false)
        window.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        window.ignoresMouseEvents = true
        window.contentView = host
        window.orderFront(nil)
        defer { window.orderOut(nil) }
        for _ in 0 ..< settle {
          host.layoutSubtreeIfNeeded()
          try await Task.sleep(for: .milliseconds(40))
        }
        let bitmap = try #require(host.bitmapImageRepForCachingDisplay(in: host.bounds))
        host.cacheDisplay(in: host.bounds, to: bitmap)
        try CreateChannelGuidanceTests.expectWindowBackground(bitmap, dark: dark)
        return bitmap
      }

      /// Light beside dark, recorded as one attachment; the words Vision read in each, or nil on the CI runner.
      private static func lightAndDark(named name: String, _ draw: (Bool) async throws -> NSBitmapImageRep) async throws -> [String]? {
        var columns: [[CGImage]] = []
        var texts: [String]? = []
        for dark in [false, true] {
          let bitmap = try await draw(dark)
          try columns.append([#require(bitmap.cgImage)])
          if let lines = try recognizedLines(in: bitmap) {
            texts?.append(lines.joined(separator: " "))
          } else {
            texts = nil
          }
        }
        let combined = try RoomHeaderTests.stitched(columns)
        try Attachment.record(#require(combined.representation(using: .png, properties: [:])), named: "\(name).png")
        return texts
      }

      /// Web `Empty.noMessagesTitle` over `Empty.noMessagesDescription` (`rooms-client.tsx`).
      @Test func anEmptyChannelInvitesTheFirstMessage() async throws {
        let texts = try await Self.lightAndDark(named: "copy-empty-transcript") { dark in
          let state = WorkspaceState(clientProvider: { _ in Client.connecting(to: URL(string: "https://example.com")!) })
          state.rooms = [Self.channel()]
          state.timeline.reset(roomId: Self.roomId)
          state.timeline.failInitialLoad(message: "", generation: state.timeline.generation)
          state.transcriptError = nil
          return try await Self.render(RoomTimelineView(roomId: Self.roomId).environmentObject(state).environmentObject(AuthState()),
                                       size: NSSize(width: 640, height: 300), dark: dark)
        }
        for text in texts ?? [] {
          #expect(text.contains("No messages yet"), "Vision read \(text)")
          // Vision reads "AI" as "Al" at times, so the drawn line is checked around it; `exactCopy` pins the words.
          #expect(text.contains("Start the channel with a message or mention an") && text.contains("coworker."), "Vision read \(text)")
          #expect(!text.contains("New messages will appear here"), "Vision read \(text)")
        }
      }

      /// The exact words behind the renders Vision cannot read letter for letter: "AI" against "Al", and the
      /// Files root (exact in `drivePickerRootNamesTheWorkspacesFiles`).
      @Test func exactCopy() {
        #expect(String(localized: RoomTimelineView.emptyDescription) == "Start the channel with a message or mention an AI coworker.")
        #expect(ParticipantDetailsView.aiKindLabel(.coworker("cow_1")) == "AI coworker")
        #expect(ParticipantDetailsView.aiKindLabel(.sokoBot("bot_1")) == "Personal assistant")
        #expect(ParticipantDetailsView.aiKindLabel(.human("user_ada")) == nil)
        #expect(String(localized: ComposerTooLongHint.message) == "Too long to send as text")
      }

      /// Web `RoomSearch.idle`, `RoomSearch.empty` and `RoomSearch.replyBadge` (`room-search-panel.tsx`).
      @Test func searchSpeaksWebsWords() async throws {
        var reply = chatRoomMessage(from: .init(clientTurnId: "reply", roomId: "room", content: "A matching reply.",
                                                createdAt: Date(timeIntervalSinceNow: -400 * 86400),
                                                sender: .init(id: "user", name: "Ada", email: "ada@example.com", presence: .online)))
        reply.id = "reply"
        reply.parentMessageId = "parent"
        let answered = RoomSearch(debounce: .zero)
        try await answered.search(query: "matching", roomId: "room", client: Self.client(answering: [reply]), organizationSlug: nil)
        try #require(answered.results.map(\.id) == ["reply"])
        let empty = RoomSearch(debounce: .zero)
        try await empty.search(query: "nothing", roomId: "room", client: Self.client(answering: []), organizationSlug: nil)
        try #require(empty.presentation(for: "nothing").placeholder == .empty)

        func panel(_ search: RoomSearch, _ query: String) -> some View {
          RoomSearchResultsView(search: search, query: query, jumpingId: nil, jumpError: nil, select: { _ in }, retry: {}, close: {})
        }
        let texts = try await Self.lightAndDark(named: "copy-search") { dark in
          try await Self.render(HStack(spacing: 0) {
            panel(RoomSearch(debounce: .zero), "")
            Divider()
            panel(empty, "nothing")
            Divider()
            panel(answered, "matching")
          }, size: NSSize(width: 860, height: 240), dark: dark)
        }
        for text in texts ?? [] {
          #expect(text.contains("Type to search messages in this chat."), "Vision read \(text)")
          #expect(text.contains("No messages match your search."), "Vision read \(text)")
          #expect(text.contains("Thread reply"), "Vision read \(text)")
        }
      }

      /// Web `DriveFilePicker`: "Select from Files", the "My Files" root of a personal workspace, and each file's
      /// upload day under its name.
      @Test func theFilesPickerNamesMyFilesAndUploadDays() async throws {
        let items: [Components.Schemas.DriveItem] = [
          .folder(.init(_type: .folder, name: "Reports", path: "Reports")),
          .file(.init(value1: .init(name: "q3-review.pdf", fileUrl: "https://example.com/q3-review.pdf", pathname: "drive/users/me/q3-review.pdf",
                                    size: 1_024_000, uploadedAt: Date(timeIntervalSince1970: 1_791_194_400)),
                      value2: .init(_type: .file)))
        ]
        let texts = try await Self.lightAndDark(named: "copy-files-picker") { dark in
          try await Self.render(DriveFilePickerView(load: { _, _ in items }, select: { _ in }),
                                size: NSSize(width: 520, height: 360), dark: dark)
        }
        for text in texts ?? [] {
          // The root crumb's words are exact in `drivePickerRootNamesTheWorkspacesFiles`; Vision has read its
          // "My" with Cyrillic letters.
          #expect(text.contains("Select from Files"), "Vision read \(text)")
          #expect(text.contains("Oct 5") && text.contains("Folder"), "Vision read \(text)")
          #expect(!text.contains("Attach from Files"), "Vision read \(text)")
        }
      }

      /// Web `MessageQuoteBlock`: a clamped quote opens with "More", not the body's "Show more".
      @Test func aLongQuoteOffersMore() async throws {
        let quote = Components.Schemas.ChatRoomMessageQuote(
          messageId: "source", authorName: "Ben",
          snippet: (1 ... 8).map { "Line \($0) of the quoted release plan." }.joined(separator: "\n\n")
        )
        let texts = try await Self.lightAndDark(named: "copy-quote-more") { dark in
          try await Self.render(MessageQuoteView(quote: quote).padding(12), size: NSSize(width: 420, height: 220), dark: dark)
        }
        for text in texts ?? [] {
          #expect(text.contains("More"), "Vision read \(text)")
          #expect(!text.contains("Show more"), "Vision read \(text)")
        }
      }

      /// Web's room composer: "Message #{channel}" when empty; over the limit, "Too long to send as text" beside
      /// "Convert to file" (`room-composer.tsx` `belowEditor`).
      @Test func theComposerSpeaksWebsWords() async throws {
        let userId = UUID().uuidString
        let saved = SavedComposeDraft(userId: userId, organizationId: nil, roomId: Self.roomId)
        defer { saved.save("") }
        func composer(draft: String, dark: Bool) async throws -> NSBitmapImageRep {
          saved.save(draft)
          let state = WorkspaceState()
          state.rooms = [Self.channel()]
          state.timeline.reset(roomId: Self.roomId)
          state.timeline.failInitialLoad(message: "Fixture has no server", generation: state.timeline.generation)
          return try await Self.render(ChatComposerView(userId: userId, organizationId: nil, roomId: Self.roomId)
            .environmentObject(state).environmentObject(AuthState())
            .environmentObject(ComposeUploads(savedDraft: saved)).environmentObject(ComposerAttachmentIngress()),
            size: NSSize(width: 560, height: draft.isEmpty ? 200 : 380), dark: dark)
        }
        let empty = try await Self.lightAndDark(named: "copy-composer-empty") { try await composer(draft: "", dark: $0) }
        for text in empty ?? [] {
          #expect(text.contains("Message #launch"), "Vision read \(text)")
        }
        let long = try await Self.lightAndDark(named: "copy-composer-too-long") {
          try await composer(draft: String(repeating: "word ", count: 2100), dark: $0)
        }
        for text in long ?? [] {
          #expect(text.contains("Too long to send as text"), "Vision read \(text)")
          #expect(text.contains("Convert to file"), "Vision read \(text)")
          #expect(!text.contains("Markdown file"), "Vision read \(text)")
        }
      }

      /// Web `PinnedMessages.couldNotLoad`: a pin whose message is gone.
      @Test func aPinWithoutItsMessageSaysItCouldNotBeLoaded() async throws {
        let item = Components.Schemas.ChatRoomPinnedMessageListItem(messageId: "gone", pinnedAt: Self.created, message: nil)
        let texts = try await Self.lightAndDark(named: "copy-pin-gone") { dark in
          try await Self.render(PinnedMessageCard(item: item, room: Self.channel(), channels: [], isJumping: false, isUpdating: false,
                                                  jump: {}, unpin: {})
              .padding(12).environmentObject(WorkspaceState()).environmentObject(AuthState()),
            size: NSSize(width: 340, height: 80), dark: dark)
        }
        for text in texts ?? [] {
          #expect(text.contains("Message could not be loaded"), "Vision read \(text)")
        }
      }

      /// Web `RoomRoster.empty`, shown only when the room lists nobody at all.
      @Test func anEmptyRosterSaysNoMembersToShow() async throws {
        let texts = try await Self.lightAndDark(named: "copy-roster-empty") { dark in
          try await Self.render(RoomDetailsView(room: Self.channel(), close: {})
            .environmentObject(WorkspaceState()).environmentObject(AuthState()),
            size: NSSize(width: 320, height: 360), dark: dark)
        }
        for text in texts ?? [] {
          #expect(text.contains("No members to show."), "Vision read \(text)")
        }
      }

      /// Web's participant card names no kind for a person; an AI coworker reads as web's `coworkerBadge`.
      @Test func aPersonsCardNamesNoKind() async throws {
        let person = try #require(ChatParticipantProfile(sender: .case1(.init(_type: .user, user: .init(
          id: "user_ada", name: "Ada Lovelace", email: "ada@example.com", image: nil, presence: .online
        )))))
        let coworker = try #require(ChatParticipantProfile(sender: .case2(.init(_type: .coworker, coworker: .init(
          id: "cow_1", name: "Elena", slug: "elena", caption: nil, image: nil, presence: .online
        )))))
        let texts = try await Self.lightAndDark(named: "copy-participant-cards") { dark in
          try await Self.render(HStack(alignment: .top, spacing: 0) {
            ParticipantDetailsView(profile: person)
            Divider()
            ParticipantDetailsView(profile: coworker)
          }
          .environmentObject(WorkspaceState()).environmentObject(AuthState()),
          size: NSSize(width: 600, height: 160), dark: dark)
        }
        for text in texts ?? [] {
          #expect(text.contains("Ada Lovelace") && !text.contains("Person"), "Vision read \(text)")
          // A kind line is drawn for the coworker; its exact words ("AI", not "Al") are pinned by `exactCopy`.
          #expect(text.contains(" coworker"), "Vision read \(text)")
        }
      }

      /// Web's sidebar row menu: `Actions.markUnread`, "Mark as unread".
      @Test func theRoomMenuSaysMarkAsUnread() async throws {
        let state = WorkspaceState()
        // Unread, so the row lists whether or not this Mac's sidebar has its Unreads filter on.
        var room = Self.channel()
        room.unreadCount = 2
        state.rooms = [room]
        let host = NSHostingView(rootView: ConversationSidebarView()
          .environmentObject(state).environmentObject(AuthState())
          .frame(width: 260, height: 300))
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 260, height: 300), styleMask: [.titled], backing: .buffered, defer: false)
        window.contentView = host
        window.makeKeyAndOrderFront(nil)
        defer { window.orderOut(nil) }
        let table = try await waitForView(in: host, timeoutMessage: "The sidebar never listed the room") {
          Self.views(NSTableView.self, in: host).first { $0.numberOfRows > 1 }
        }
        let recorder = MenuRecorder()
        defer { recorder.stop() }
        // The room's row is the one whose menu holds the room actions; section headers open none.
        var titles: [String] = []
        for row in 0 ..< table.numberOfRows where !titles.contains("Pin") {
          let frame = table.rect(ofRow: row)
          let count = recorder.menus.count
          for type in [NSEvent.EventType.rightMouseDown, .rightMouseUp] {
            let event = try #require(NSEvent.mouseEvent(
              with: type, location: table.convert(NSPoint(x: frame.midX, y: frame.midY), to: nil), modifierFlags: [],
              timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window.windowNumber, context: nil,
              eventNumber: 0, clickCount: 1, pressure: type == .rightMouseDown ? 1 : 0
            ))
            NSApp.postEvent(event, atStart: false)
          }
          titles = try await recorder.menu(after: count)?.items.map(\.title) ?? []
        }
        #expect(titles.contains("Mark as unread"), "\(titles)")
        #expect(!titles.contains("Mark unread"), "\(titles)")
      }

      // MARK: - Helpers

      /// Vision's lines in `bitmap`, or nil where it cannot read at all (the CI runner). Accurate first; where its
      /// model fails to load (seen on macOS 27.0.1 with an e5rt error), the fast recogniser, which still reads these
      /// short UI strings.
      static func recognizedLines(in bitmap: NSBitmapImageRep) throws -> [String]? {
        let image = try #require(bitmap.cgImage)
        for level in [VNRequestTextRecognitionLevel.accurate, .fast] {
          let request = VNRecognizeTextRequest()
          request.recognitionLevel = level
          request.recognitionLanguages = ["en-US"]
          request.usesLanguageCorrection = false
          guard (try? VNImageRequestHandler(cgImage: image).perform([request])) != nil else { continue }
          return (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }
        }
        return nil
      }

      private static func views<V: NSView>(_ type: V.Type, in view: NSView) -> [V] {
        ((view as? V).map { [$0] } ?? []) + view.subviews.flatMap { views(type, in: $0) }
      }

      /// A client whose every request is answered with one page of `messages`.
      private static func client(answering messages: [Components.Schemas.ChatRoomMessage]) throws -> Client {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .custom { date, encoder in
          let formatter = ISO8601DateFormatter()
          formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
          var value = encoder.singleValueContainer()
          try value.encode(formatter.string(from: date))
        }
        let rows = try #require(String(bytes: encoder.encode(messages), encoding: .utf8))
        let body = "{\"data\":\(rows),\"meta\":{\"timestamp\":\"2026-10-05T12:00:00.000Z\",\"requestId\":\"fixture\",\"pagination\":{\"cursor\":null,\"limit\":50,\"total\":\(messages.count),\"nextCursor\":null}}}"
        return try Client.connecting(to: #require(URL(string: "https://example.com")), transport: FixedBodyTransport(body: body))
      }
    }
  }

  private struct FixedBodyTransport: ClientTransport {
    let body: String

    func send(_: HTTPRequest, body _: HTTPBody?, baseURL _: URL, operationID _: String) async throws -> (HTTPResponse, HTTPBody?) {
      (HTTPResponse(status: .ok), HTTPBody(body))
    }
  }
#endif

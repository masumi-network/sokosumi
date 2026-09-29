#if os(macOS)
  import AppKit
  import CoreAPI
  @testable import Sokosumi
  import SokosumiAuth
  import SokosumiChat
  import SokosumiWorkspace
  import SwiftUI
  import Testing

  @MainActor private final class OpenCount {
    var value = 0
  }

  extension NativeWindowTests {
    /// Row 24h: the reply bar under a thread parent in the real message row, as web's `ThreadReplyBar` draws
    /// it — the repliers' faces, the count or the new count on the accent bar, and the last reply's age. The
    /// test host builds no accessibility tree, so the tests click by position and compare pixels.
    @MainActor struct ThreadReplyBarViewTests {
      private static let base = Date(timeIntervalSince1970: 1_790_251_200)
      private static let locale = Locale(identifier: "en_US")

      private static func user(_ name: String) -> Components.Schemas.ChatRoomMessageSender {
        .case1(.init(_type: .user, user: .init(id: "user_\(name.lowercased())", name: name, email: "\(name.lowercased())@example.com",
                                               image: nil, presence: .offline)))
      }

      /// A parent posted at a fixed time whose last reply came four minutes before the real clock, which the
      /// bar's age reads. The content is the id: every fixture parent says something else.
      private static func parent(
        _ content: String, replies: Int, unread: Int?, repliers: [String], minutes: Double
      ) -> Components.Schemas.ChatRoomMessage {
        var message = chatRoomMessage(from: .init(
          clientTurnId: content, roomId: "room_1", content: content, createdAt: base.addingTimeInterval(minutes * 60),
          sender: .init(id: "user_ben", name: "Ben", email: "ben@example.com", presence: .offline)
        ))
        message.id = content
        message.metadata = nil
        message.threadReplyCount = replies
        message.threadUnreadReplyCount = unread
        message.threadLastReplyAt = replies > 0 ? Date().addingTimeInterval(-240) : nil
        message.threadRepliers = repliers.isEmpty ? nil : repliers.map(user)
        return message
      }

      /// Read, unread, three faces and one reply: the four bars the fixture draws, top to bottom.
      private static var fixture: [Components.Schemas.ChatRoomMessage] {
        [
          parent("Weekly sync notes are up.", replies: 3, unread: 0, repliers: ["Grace", "Linus"], minutes: 0),
          parent("Release checklist for Friday", replies: 5, unread: 2, repliers: ["Ada"], minutes: 1),
          parent("Who owns the launch copy?", replies: 12, unread: nil, repliers: ["Ada", "Grace", "Linus"], minutes: 2),
          parent("Lunch at noon?", replies: 1, unread: 0, repliers: ["Grace"], minutes: 3)
        ]
      }

      private static func render(_ messages: [Components.Schemas.ChatRoomMessage], dark: Bool, opens: Bool = true) async throws -> NSBitmapImageRep {
        let content = VStack(alignment: .leading, spacing: 0) {
          ForEach(messages, id: \.id) { message in
            MessageRowView(message: message, isContinuation: false, outbound: nil, onRetry: nil, onRemove: nil,
                           onReply: opens ? {} : nil, horizontalInset: 12)
          }
        }
        .padding(.vertical, 12)
        .frame(width: 520, alignment: .leading)
        .background(.background)
        .environmentObject(WorkspaceState()).environmentObject(AuthState())
        .environment(\.colorScheme, dark ? .dark : .light)
        .environment(\.locale, Self.locale)
        let host = NSHostingView(rootView: content)
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 520, height: 400), styleMask: [.titled], backing: .buffered, defer: false)
        window.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        window.contentView = host
        window.orderFront(nil)
        defer { window.orderOut(nil) }
        // Avatars and the markdown body settle over a few layout passes.
        for _ in 0 ..< 10 {
          host.layoutSubtreeIfNeeded()
          try await Task.sleep(for: .milliseconds(20))
        }
        return try fittedBitmap(of: host, in: window)
      }

      private static func differingBytes(_ lhs: NSBitmapImageRep, _ rhs: NSBitmapImageRep) throws -> Int {
        let left = try #require(lhs.bitmapData), right = try #require(rhs.bitmapData)
        let count = lhs.bytesPerRow * lhs.pixelsHigh
        try #require(count == rhs.bytesPerRow * rhs.pixelsHigh, "Same size: \(lhs.size) vs \(rhs.size)")
        return (0 ..< count).count { left[$0] != right[$0] }
      }

      @Test(arguments: [false, true])
      func rendersReadUnreadAndFaces(dark: Bool) async throws {
        let bitmap = try await Self.render(Self.fixture, dark: dark)
        try Attachment.record(#require(bitmap.representation(using: .png, properties: [:])), named: "thread-reply-bar-\(dark ? "dark" : "light").png")
        let corner = try #require(bitmap.colorAt(x: 2, y: bitmap.pixelsHigh - 2)?.usingColorSpace(.deviceRGB))
        #expect(corner.alphaComponent == 1, "Hosted over the window background: alpha \(corner.alphaComponent)")
        #expect(dark ? corner.brightnessComponent < 0.5 : corner.brightnessComponent > 0.5)
        // Vision reads text only on a local run (the CI runner returns nil); the pixel tests carry the rest.
        guard let lines = try RoomThreadOverviewGroupsViewTests.recognizedText(in: bitmap) else { return }
        let texts = lines.map(\.text)
        for label in ["3 replies", "2 new replies", "12 replies", "1 reply"] {
          #expect(texts.contains { $0.contains(label) }, "\(label) in \(texts)")
        }
        // The age follows the environment locale, as the app's other relative times do; the fixture pins English.
        let age = threadReplyAgeLabel(since: Date().addingTimeInterval(-240), now: Date(), locale: Self.locale)
        #expect(texts.count { $0.contains(age) } == 4, "Each bar ends with the last reply's age, \(age): \(texts)")
      }

      /// The bar alone in a fixed frame, so two states compare pixel for pixel.
      private static func renderBar(_ message: Components.Schemas.ChatRoomMessage, dark: Bool) throws -> NSBitmapImageRep {
        let bar = try #require(ThreadReplyBar(message: message))
        let host = NSHostingView(rootView: ThreadReplyBarButton(bar: bar) {}
          .frame(width: 240, height: 40, alignment: .leading)
          .padding(.horizontal, 8)
          .background(.background)
          .environment(\.colorScheme, dark ? .dark : .light)
          .environment(\.locale, Self.locale))
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 256, height: 40), styleMask: [.titled], backing: .buffered, defer: false)
        window.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        window.contentView = host
        window.orderFront(nil)
        defer { window.orderOut(nil) }
        return try fittedBitmap(of: host, in: window)
      }

      /// Unread reads as a bar: the same bar with no unread replies draws without the tint.
      @Test(arguments: [false, true])
      func unreadDrawsTheTintedBar(dark: Bool) throws {
        let unread = try Self.renderBar(Self.parent("Release checklist", replies: 5, unread: 2, repliers: [], minutes: 0), dark: dark)
        let read = try Self.renderBar(Self.parent("Release checklist", replies: 5, unread: 0, repliers: [], minutes: 0), dark: dark)
        let readAgain = try Self.renderBar(Self.parent("Release checklist", replies: 5, unread: 0, repliers: [], minutes: 0), dark: dark)
        #expect(try Self.differingBytes(read, readAgain) == 0, "The fixture draws the same bar twice alike.")
        #expect(try Self.differingBytes(unread, read) > 2000)
      }

      /// The faces are drawn beside the count, and a bar with faces is no taller than one without.
      @Test(arguments: [false, true])
      func theRepliersDrawTheirFaces(dark: Bool) async throws {
        let faces = try Self.renderBar(Self.parent("Release checklist", replies: 5, unread: 0, repliers: ["Ada", "Grace"], minutes: 0), dark: dark)
        let none = try Self.renderBar(Self.parent("Release checklist", replies: 5, unread: 0, repliers: [], minutes: 0), dark: dark)
        #expect(try Self.differingBytes(faces, none) > 500)
        let withFaces = try await Self.render([Self.parent("Release checklist", replies: 5, unread: 0, repliers: ["Ada"], minutes: 0)], dark: dark)
        let withoutFaces = try await Self.render([Self.parent("Release checklist", replies: 5, unread: 0, repliers: [], minutes: 0)], dark: dark)
        #expect(withFaces.pixelsHigh == withoutFaces.pixelsHigh, "Faces do not make the row taller.")
      }

      /// Web draws no bar where the row cannot open a thread (the thread view's own parent) or nobody replied.
      @Test func noBarWithoutAThreadToOpen() async throws {
        let unopenable = try await Self.render([Self.parent("Release checklist", replies: 5, unread: 2, repliers: ["Ada"], minutes: 0)],
                                               dark: false, opens: false)
        let unreplied = try await Self.render([Self.parent("Release checklist", replies: 0, unread: nil, repliers: [], minutes: 0)], dark: false)
        #expect(unopenable.pixelsHigh == unreplied.pixelsHigh)
        #expect(try Self.differingBytes(unopenable, unreplied) == 0)
      }

      @Test func aClickOpensTheThread() async throws {
        let count = OpenCount()
        let bar = try #require(ThreadReplyBar(message: Self.parent("Release checklist", replies: 5, unread: 2, repliers: ["Ada"], minutes: 0)))
        let host = NSHostingView(rootView: ThreadReplyBarButton(bar: bar) { count.value += 1 }.padding(16).background(.background))
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 240, height: 60), styleMask: [.titled], backing: .buffered, defer: false)
        defer { window.orderOut(nil) }
        window.contentView = host
        window.makeKeyAndOrderFront(nil)
        let bitmap = try fittedBitmap(of: host, in: window)
        clickPixel(CGPoint(x: CGFloat(bitmap.pixelsWide) / 2, y: CGFloat(bitmap.pixelsHigh) / 2), of: bitmap, drawnFrom: host, in: window)
        try await Task.sleep(for: .milliseconds(200))
        #expect(count.value == 1)
      }
    }
  }
#endif

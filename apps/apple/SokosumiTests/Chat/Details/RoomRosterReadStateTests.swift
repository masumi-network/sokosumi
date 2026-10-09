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
    /// Row 31b2 (web `RoomRosterPanel` with `groupRosterMembers`): the Members inspector lists the people who have
    /// read the room freshest first with their read time, gathers the rest under "Not read yet", and names People,
    /// Guests and Coworkers with counts once two kinds are on the roster. The real `RoomDetailsView` is hosted over
    /// the window background in light and dark; its words and their order come from the hosted view's accessibility
    /// nodes (`hostedTexts`), never from the pixels.
    @MainActor struct RoomRosterReadStateTests {
      private static let roomId = "550e8400-e29b-41d4-a716-446655440312"

      /// Read times relative to the moment the test runs, at whole minutes and hours so a slow run cannot round a
      /// label over to the next unit.
      private static func person(
        _ name: String, readSecondsAgo: Double?, access: Components.Schemas.ChatRoomAccess = .member
      ) -> Components.Schemas.ChatRoomUserParticipant {
        let first = name.split(separator: " ")[0].lowercased()
        return .init(id: "user_\(first)", name: name, email: "\(first)@example.com", image: nil, presence: .offline,
                     access: access, lastReadAt: readSecondsAgo.map { Date().addingTimeInterval(-$0) })
      }

      /// An External channel: two readers, two who never opened it, a guest who read yesterday, a Coworker and a
      /// Soko Bot. The test's workspace has no signed-in viewer, so no row is the viewer's own.
      private static func channel() -> Components.Schemas.ChatRoom {
        let created = Date(timeIntervalSince1970: 1_790_000_000)
        return .init(
          id: roomId, name: "launch", kind: .channel, isSelfDirect: false, isGroupDirect: false, isReadOnly: false,
          discoverability: .external, createdByUserId: "user_grace", createdAt: created, updatedAt: created, unreadCount: 0,
          unreadMentionCount: 0, markedUnread: false, myAccess: .init(value1: .member, value2: "member"),
          userMembers: [
            person("Alan Turing", readSecondsAgo: nil), person("Linus Torvalds", readSecondsAgo: 3 * 3600),
            person("Margaret Hamilton", readSecondsAgo: nil), person("Grace Hopper", readSecondsAgo: 120),
            person("Zed Partner", readSecondsAgo: 86400, access: .guest)
          ],
          formerUserMembers: [],
          coworkerMembers: [.init(id: "cow_1", name: "Elena", slug: "elena", caption: nil, image: nil, presence: .online)],
          sokoBotMembers: [.init(id: "bot_1", name: "Assistant", caption: "My assistant", ownerUserId: "user_grace", presence: .online)]
        )
      }

      @Test func theInspectorStatesWhoHasReadTheRoom() async throws {
        let appearances = try await ChatCopyAlignmentTests.lightAndDark(named: "room-roster-read-state") { dark in
          try await ChatCopyAlignmentTests.render(RoomDetailsView(room: Self.channel(), close: {})
            .environmentObject(WorkspaceState()).environmentObject(AuthState()),
            size: NSSize(width: 320, height: 660), dark: dark)
        }
        for texts in appearances {
          func position(_ text: String) -> Int? {
            texts.firstIndex(of: text)
          }
          // Headings with counts: every host member under People, read or not, then Guests and Coworkers.
          for heading in ["People, 4", "Guests, 1", "Coworkers, 2", "Not read yet, 2"] {
            #expect(texts.contains(heading), "\(heading) in \(texts)")
          }
          // Each reader states when, for the tooltip and assistive technology; nobody else does.
          for label in ["Last read 2 minutes ago", "Last read 3 hours ago", "Last read 1 day ago"] {
            #expect(texts.contains(label), "\(label) in \(texts)")
          }
          // A node can expose the same words as its label and its title, so count distinct sentences.
          #expect(Set(texts.filter { $0.hasPrefix("Last read") }).count == 3, "\(texts)")
          // Freshest reader first, then the never-read under their subheading by name, then Guests, then agents.
          let order = ["Grace Hopper", "Linus Torvalds", "Not read yet, 2", "Alan Turing", "Margaret Hamilton",
                       "Guests, 1", "Zed Partner", "Coworkers, 2", "Elena", "Assistant"].map(position)
          #expect(order.allSatisfy { $0 != nil } && order.compactMap(\.self) == order.compactMap(\.self).sorted(), "\(texts)")
          // The Coworkers heading says it once, so no row repeats a "Coworker" badge; a Soko Bot keeps its own.
          #expect(!texts.contains("Coworker"), "\(texts)")
          #expect(texts.contains("Personal assistant"), "\(texts)")
        }
      }

      /// A room of people alone names no section, but still gathers the never-read under their subheading.
      @Test func aRoomOfPeopleAloneNamesNoSection() async throws {
        var room = Self.channel()
        room.userMembers.removeAll { $0.access == .guest }
        room.coworkerMembers = []
        room.sokoBotMembers = []
        let drawn = try await ChatCopyAlignmentTests.render(RoomDetailsView(room: room, close: {})
          .environmentObject(WorkspaceState()).environmentObject(AuthState()),
          size: NSSize(width: 320, height: 420), dark: false)
        #expect(!drawn.texts.contains { $0.hasPrefix("People") }, "\(drawn.texts)")
        #expect(drawn.texts.contains("Not read yet, 2"), "\(drawn.texts)")
      }
    }
  }
#endif

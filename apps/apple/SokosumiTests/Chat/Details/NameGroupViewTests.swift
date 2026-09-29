#if os(macOS)
  import AppKit
  import CoreAPI
  @testable import Sokosumi
  import SokosumiChat
  import SwiftUI
  import Testing

  @MainActor struct NameGroupViewTests {
    private let expected: [String: [String: String]] = [
      "en": ["Name Group…": "Name Group…", "Group name": "Group name",
             "%@ named the group %@": "Ada named the group Launch crew", "%@ removed the group name": "Ada removed the group name"],
      "de": ["Name Group…": "Gruppe benennen…", "Group name": "Gruppenname",
             "%@ named the group %@": "Ada hat die Gruppe Launch crew genannt", "%@ removed the group name": "Ada hat den Gruppennamen entfernt"],
      "es": ["Name Group…": "Poner nombre al grupo…", "Group name": "Nombre del grupo",
             "%@ named the group %@": "Ada llamó al grupo Launch crew", "%@ removed the group name": "Ada quitó el nombre del grupo"]
    ]

    @Test(arguments: ["en", "de", "es"])
    func groupNameStringsAreLocalized(locale: String) throws {
      let path = try #require(Bundle.main.path(forResource: locale, ofType: "lproj"))
      let bundle = try #require(Bundle(path: path))
      let strings = try #require(expected[locale])
      func localized(_ key: String) -> String {
        bundle.localizedString(forKey: key, value: nil, table: groupNameTable)
      }
      #expect(localized("Name Group…") == strings["Name Group…"])
      #expect(localized("Group name") == strings["Group name"])
      #expect(String(format: localized("%@ named the group %@"), "Ada", "Launch crew") == strings["%@ named the group %@"])
      #expect(String(format: localized("%@ removed the group name"), "Ada") == strings["%@ removed the group name"])
    }

    @Test(arguments: [false, true])
    func sheetRendersWithoutSaving(dark: Bool) async throws {
      let room = Components.Schemas.ChatRoom(
        id: "fixture", name: "Ann, Bob", kind: .direct, isSelfDirect: false, isGroupDirect: true, groupName: "Launch crew",
        createdByUserId: "me", createdAt: .distantPast, updatedAt: .distantPast, unreadCount: 0, unreadMentionCount: 0,
        markedUnread: false, myAccess: .member, userMembers: [], coworkerMembers: [], sokoBotMembers: []
      )
      let model = GroupNaming(room: room)
      let content = NameGroupView(room: room, model: model) { _ in
        Issue.record("Rendering must not save")
        return false
      }
      .background(.background)
      .environment(\.locale, Locale(identifier: "de"))
      .environment(\.colorScheme, dark ? .dark : .light)
      let host = NSHostingView(rootView: content)
      host.frame = NSRect(x: 0, y: 0, width: 420, height: 400)
      host.layoutSubtreeIfNeeded()
      try await Task.sleep(for: .milliseconds(50))
      host.layoutSubtreeIfNeeded()
      #expect(model.draft.name == "Launch crew")
      #expect(model.canSave)
      #expect(host.fittingSize.height < 400)
    }
  }
#endif

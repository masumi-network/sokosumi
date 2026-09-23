import CoreAPI
import Foundation
import SokosumiChat
import Testing

@MainActor
struct GroupNamingTests {
  private func room(
    kind: Components.Schemas.ChatRoom.KindPayload = .direct,
    isSelfDirect: Bool = false,
    isGroupDirect: Bool = true,
    groupName: String? = nil
  ) -> Components.Schemas.ChatRoom {
    .init(
      id: "room", name: "Ann, Bob", kind: kind, isSelfDirect: isSelfDirect, isGroupDirect: isGroupDirect, groupName: groupName,
      discoverability: nil, createdByUserId: "me", createdAt: .distantPast, updatedAt: .distantPast,
      unreadCount: 0, unreadMentionCount: 0, markedUnread: false, myAccess: .member,
      userMembers: [
        .init(id: "me", name: "Me", email: "me@example.com", presence: .online),
        .init(id: "ann", name: "Ann", email: "ann@example.com", presence: .online),
        .init(id: "bob", name: "Bob", email: "bob@example.com", presence: .online)
      ],
      coworkerMembers: [], sokoBotMembers: []
    )
  }

  @Test func onlyGroupDirectsCanBeNamed() {
    #expect(GroupNameDraft.canName(room()))
    #expect(GroupNameDraft.canName(room(groupName: "Launch crew")))
    // 1:1, coworker and personal assistant Directs are not started for three humans; neither is Self.
    #expect(!GroupNameDraft.canName(room(isGroupDirect: false)))
    #expect(!GroupNameDraft.canName(room(isSelfDirect: true, isGroupDirect: false)))
    #expect(!GroupNameDraft.canName(room(kind: .channel, isGroupDirect: false)))
    #expect(!GroupNaming(room: room(isGroupDirect: false)).canSave)
  }

  @Test func draftTrimsCapsAndClearsWhenEmpty() {
    var draft = GroupNameDraft(room: room(groupName: "Launch crew"))
    #expect(draft.name == "Launch crew")
    #expect(draft.isUnchanged)
    draft.setName("  Launch crew  ")
    #expect(draft.groupName == "Launch crew")
    #expect(draft.isUnchanged)
    draft.setName(String(repeating: "x", count: 90))
    #expect(draft.name.count == GroupNameDraft.maxLength)
    draft.setName(String(repeating: "👩🏽", count: 80))
    #expect(draft.name.utf16.count <= GroupNameDraft.maxLength)
    draft.setName("  Crew ")
    #expect(draft.groupName == "Crew")
    #expect(draft.updateRequest == .init(groupName: "Crew"))
    draft.setName("   ")
    #expect(draft.groupName == nil)
    #expect(!draft.isUnchanged)
    // An empty string clears: a nil optional would leave the only field a Direct accepts out of the body.
    #expect(draft.updateRequest == .init(groupName: ""))
    #expect(GroupNameDraft(room: room()).updateRequest == .init(groupName: ""))
  }

  @Test func savingTheUnchangedNameSendsNothing() async {
    let model = GroupNaming(room: room(groupName: "Launch crew"))
    model.draft.setName(" Launch crew ")
    let closed = await model.save { _ in
      Issue.record("Unchanged name was sent")
      return true
    }
    #expect(closed)
    let unnamed = GroupNaming(room: room())
    unnamed.draft.setName("  ")
    #expect(await unnamed.save { _ in
      Issue.record("Clearing an unnamed group was sent")
      return true
    })
  }

  @Test func saveSendsTheDraftAndKeepsItOnFailure() async {
    let model = GroupNaming(room: room())
    model.draft.setName("Launch crew")
    let draft = model.draft
    let failed = await model.save { _ in
      #expect(model.saving)
      let duplicate = await model.save { _ in
        Issue.record("Duplicate save")
        return true
      }
      #expect(!duplicate)
      throw ChatServiceError.unprocessable(statusCode: 400, message: "Only group Directs can be named.")
    }
    #expect(!failed)
    #expect(!model.saving)
    #expect(model.draft == draft)
    #expect(model.errorMessage == "Only group Directs can be named.")
    let saved = await model.save { submitted in
      #expect(submitted.groupName == "Launch crew")
      return true
    }
    #expect(saved)
    #expect(model.errorMessage == nil)
  }

  @Test func renameRowRetitlesItsOwnDirect() async throws {
    let named = "{\"action\":\"named\",\"name\":\"Launch crew\",\"actor\":{\"id\":\"ann\",\"name\":\"Ann\"}}"
    let cleared = "{\"action\":\"cleared\",\"name\":null,\"actor\":{\"id\":\"ann\",\"name\":\"Ann\"}}"
    let unknown = "{\"type\":\"unknown\"}"
    let messages = try await fetchTestMessages([
      testMessageJSON(id: "550e8400-e29b-41d4-a716-446655440301", content: "Ann named the group Launch crew", sender: unknown, groupNameChange: named, roomId: "room"),
      testMessageJSON(id: "550e8400-e29b-41d4-a716-446655440302", content: "Ann removed the group name", sender: unknown, groupNameChange: cleared, roomId: "room"),
      testMessageJSON(id: "550e8400-e29b-41d4-a716-446655440303", content: "Ann named the group Launch crew", sender: unknown, groupNameChange: named, roomId: "other"),
      testMessageJSON(id: "550e8400-e29b-41d4-a716-446655440304", content: "hello", sender: unknown, roomId: "room")
    ])
    #expect(room().applyingGroupNameChange(messages[0])?.groupName == "Launch crew")
    #expect(room(groupName: "Launch crew").applyingGroupNameChange(messages[1]).map { $0.groupName == nil } == true)
    #expect(room().applyingGroupNameChange(messages[2]) == nil)
    #expect(room().applyingGroupNameChange(messages[3]) == nil)
  }
}

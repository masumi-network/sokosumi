import Foundation
@testable import SokosumiChat
import Testing

@Test func composeDraftRestoresExactTextAndClearsEmptyDrafts() throws {
  let suiteName = "compose-draft-tests-\(UUID().uuidString)"
  let defaults = try #require(UserDefaults(suiteName: suiteName))
  defer { defaults.removePersistentDomain(forName: suiteName) }
  let draft = SavedComposeDraft(userId: "me", organizationId: nil, roomId: "room", defaults: defaults)
  #expect(draft.load().isEmpty)
  draft.save("  Unsent\nmessage 👋  ")
  let reopened = SavedComposeDraft(userId: "me", organizationId: nil, roomId: "room", defaults: defaults)
  #expect(reopened.load() == "  Unsent\nmessage 👋  ")
  reopened.save("")
  #expect(draft.load().isEmpty)
  draft.save("   \n")
  #expect(draft.load().isEmpty)
}

@Test func composeDraftsStayIsolatedAcrossAccountsWorkspacesAndRooms() throws {
  let suiteName = "compose-draft-tests-\(UUID().uuidString)"
  let defaults = try #require(UserDefaults(suiteName: suiteName))
  defer { defaults.removePersistentDomain(forName: suiteName) }
  struct Scope {
    let userId: String
    let organizationId: String?
    let roomId: String
  }
  let scopes: [Scope] = [
    .init(userId: "me", organizationId: nil, roomId: "room"),
    .init(userId: "other", organizationId: nil, roomId: "room"),
    .init(userId: "me", organizationId: "org", roomId: "room"),
    .init(userId: "me", organizationId: "personal", roomId: "room"),
    .init(userId: "me", organizationId: nil, roomId: "other-room"),
    .init(userId: "me:org", organizationId: "room", roomId: "other"),
    .init(userId: "me", organizationId: "org:room", roomId: "other")
  ]
  let drafts = scopes.map {
    SavedComposeDraft(userId: $0.userId, organizationId: $0.organizationId, roomId: $0.roomId, defaults: defaults)
  }
  for (index, draft) in drafts.enumerated() {
    draft.save("Draft \(index)")
  }
  for (index, draft) in drafts.enumerated() {
    #expect(draft.load() == "Draft \(index)")
  }
  drafts[0].save("")
  #expect(drafts[1].load() == "Draft 1")
}

@Test(arguments: ["", "New draft 👋", "  "])
func failedSendRestorationPreservesNewInput(current: String) throws {
  let suiteName = "compose-draft-tests-\(UUID().uuidString)"
  let defaults = try #require(UserDefaults(suiteName: suiteName))
  defer { defaults.removePersistentDomain(forName: suiteName) }
  let draft = SavedComposeDraft(userId: "me", organizationId: nil, roomId: "room", defaults: defaults)
  let expected = current.isEmpty ? "Failed message" : "Failed message\n\n" + current
  #expect(draft.restoreFailedSend("Failed message", preserving: current) == expected)
  #expect(draft.load() == expected)
}

/// ADR 0059: a room shown in every workspace keeps its draft under the room alone. A draft saved earlier under the
/// workspace's Organization moves there once, attachments and thread drafts included.
@Test(arguments: [nil, "parent"] as [String?])
func aDraftSavedUnderTheOrganizationMovesToTheRoomKeyOnce(parentMessageId: String?) throws {
  let suiteName = "compose-draft-tests-\(UUID().uuidString)"
  let defaults = try #require(UserDefaults(suiteName: suiteName))
  defer { defaults.removePersistentDomain(forName: suiteName) }
  let attachment = ComposeAttachment(url: "https://blob.example/r/a.png", fileName: "a.png", mediaType: "image/png")
  func old() -> SavedComposeDraft {
    SavedComposeDraft(userId: "me", organizationId: "org", roomId: "room", parentMessageId: parentMessageId, defaults: defaults)
  }
  func roomKeyed() -> SavedComposeDraft {
    SavedComposeDraft(userId: "me", scope: .init(organizationId: nil, legacyOrganizationId: "org"), roomId: "room",
                      parentMessageId: parentMessageId, defaults: defaults)
  }
  old().save("Unsent")
  old().saveAttachments([attachment])

  // Opening the draft alone moves nothing; the move is its own call.
  #expect(roomKeyed().load().isEmpty)
  roomKeyed().moveLegacyDraft()
  #expect(roomKeyed().load() == "Unsent")
  #expect(roomKeyed().loadAttachments() == [attachment])
  #expect(old().load().isEmpty && old().loadAttachments().isEmpty)

  // Once moved, a newer old-keyed draft does not overwrite the room's.
  old().save("Stale")
  roomKeyed().moveLegacyDraft()
  #expect(roomKeyed().load() == "Unsent")
  #expect(old().load() == "Stale")
}

@Test func aRoomKeyedDraftIgnoresTheOrganizationKeyWhenItIsTheSame() throws {
  let suiteName = "compose-draft-tests-\(UUID().uuidString)"
  let defaults = try #require(UserDefaults(suiteName: suiteName))
  defer { defaults.removePersistentDomain(forName: suiteName) }
  SavedComposeDraft(userId: "me", organizationId: "org", roomId: "room", defaults: defaults).save("Channel draft")
  let channel = SavedComposeDraft(userId: "me", scope: .init(organizationId: "org", legacyOrganizationId: "org"), roomId: "room",
                                  defaults: defaults)
  channel.moveLegacyDraft()
  #expect(channel.load() == "Channel draft")
}

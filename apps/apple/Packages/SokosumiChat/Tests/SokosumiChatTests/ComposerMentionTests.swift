import CoreAPI
import Foundation
@testable import SokosumiChat
import Testing

struct ComposerMentionTests {
  @Test func emailIsHumanSubtitleAndSearchValue() {
    let entry = ComposerMention(id: "user-1", name: "Anna", slug: "anna", kind: .human, email: "anna@example.com")
    #expect(entry.subtitle == "anna@example.com")
    #expect(ComposerMention.matching([entry], query: "example") == [entry])
    #expect(ComposerMention.selected(in: "Hi @user-1, @user-1:previous-name", catalog: [entry]) == [entry])
  }

  @Test func mentionTokensKeepIdentityAndWebSlugRules() {
    let entry = ComposerMention(id: "user-1", name: "  René  Smith! ", slug: ComposerMention.slug(for: "  René  Smith! "), kind: .human)
    #expect(entry.token == "@user-1")
    #expect(ComposerMention.slug(for: "A__B -- C") == "a__b-c")
  }

  @Test func matchesPrefixesBeforeSubstringsWithoutReorderingTies() {
    let entries = [
      ComposerMention(id: "1", name: "Joanna", slug: "joanna", kind: .human),
      ComposerMention(id: "2", name: "Anna", slug: "anna", kind: .human),
      ComposerMention(id: "3", name: "Annette", slug: "annette", kind: .coworker)
    ]
    #expect(ComposerMention.matching(entries, query: "ANN").map(\.id) == ["2", "3", "1"])
    #expect(ComposerMention.matching(entries, query: "") == entries)
  }

  @Test func resolvesLegacyNamesStableIDsAndDeduplicates() {
    let entries = [
      ComposerMention(id: "user-1", name: "Anna", slug: "anna", kind: .human),
      ComposerMention(id: "user-2", name: "Renamed", slug: "renamed", kind: .human)
    ]
    let selected = ComposerMention.selected(in: "@anna @user-2:old-name @user-1:anna @unknown", catalog: entries)
    #expect(selected.map(\.id) == ["user-1", "user-2"])
  }

  @Test func catalogExcludesSelfAndLimitsDirectSuggestions() {
    let user = Components.Schemas.ChatRoomUserParticipant(id: "me", name: "Me", email: "me@example.com", image: nil, presence: .online)
    let peer = Components.Schemas.ChatRoomUserParticipant(id: "peer", name: "Peer", email: "peer@example.com", image: nil, presence: .online)
    var room = Components.Schemas.ChatRoom(id: "room", name: "Room", kind: .channel, createdByUserId: "me",
                                           createdAt: Date(), updatedAt: Date(), unreadCount: 0, unreadMentionCount: 0, markedUnread: false, myAccess: .member,
                                           userMembers: [user, peer], coworkerMembers: [], sokoBotMembers: [])
    #expect(ComposerMention.catalog(room: room, currentUserId: "me").map(\.id) == ["all", "peer"])
    #expect(!DirectRecipient.human("me").canOpen(from: room, currentUserId: "me", hasActiveOrganization: true))
    #expect(DirectRecipient.human("peer").canOpen(from: room, currentUserId: "me", hasActiveOrganization: true))
    #expect(!DirectRecipient.human("peer").canOpen(from: room, currentUserId: "me", hasActiveOrganization: false))
    room.myAccess = .guest
    #expect(!DirectRecipient.human("peer").canOpen(from: room, currentUserId: "me", hasActiveOrganization: true))
    room.discoverability = .external
    #expect(DirectRecipient.human("peer").canOpen(from: room, currentUserId: "me", hasActiveOrganization: false))
    #expect(!DirectRecipient.human("unknown").canOpen(from: room, currentUserId: "me", hasActiveOrganization: true))
    room.kind = .direct
    #expect(ComposerMention.catalog(room: room, currentUserId: "me").isEmpty)
    room.coworkerMembers = [.init(id: "cow", name: "Helper", slug: "helper", caption: nil, image: nil, presence: .online)]
    #expect(ComposerMention.catalog(room: room, currentUserId: "me").map(\.id) == ["all", "peer", "cow"])
  }

  @Test func usesUTF16CaretAndRejectsPersistedTokens() {
    let text = "😀 hi @an tail"
    let match = ComposerReferenceTrigger.match(in: text, caret: 9)
    #expect(match?.kind == .mention)
    #expect(match?.range == NSRange(location: 6, length: 3))
    #expect(match?.query == "an")
    for text in ["email@ann", "@id:ann", "@@ann", "hello ", "##heading"] {
      #expect(ComposerReferenceTrigger.match(in: text, caret: text.utf16.count) == nil)
    }
    #expect(ComposerReferenceTrigger.match(in: "@", caret: 1)?.query.isEmpty == true)
    #expect(ComposerReferenceTrigger.match(in: "#general", caret: 8)?.kind == .channel)
  }
}

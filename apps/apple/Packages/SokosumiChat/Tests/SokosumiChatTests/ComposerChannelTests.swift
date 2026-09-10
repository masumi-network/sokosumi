import CoreAPI
import Foundation
@testable import SokosumiChat
import Testing

struct ComposerChannelTests {
  @Test func namesWithSpacesAndDuplicateNamesMatchWebTokens() {
    let launch = ComposerChannel(id: "1", name: "Launch Room", slug: "launch-room")
    let general = ComposerChannel(id: "2", name: "General", slug: "general")
    let duplicate = ComposerChannel(id: "3", name: "GENERAL", slug: "general-2")
    #expect(launch.token(in: [launch, general]) == "#Launch Room")
    #expect(duplicate.token(in: [general, duplicate]) == "#general-2")
    #expect(ComposerChannel.matching([launch, general, duplicate], query: "GEN").map(\.id) == ["2", "3"])
    #expect(ComposerChannel.matching([launch, general], query: "room") == [launch])
  }

  @Test func catalogRequiresChannelSlugAndLabelsExternalOrganization() {
    var room = Components.Schemas.ChatRoom(id: "room", name: "Room", kind: .channel, createdByUserId: "me",
                                           createdAt: Date(), updatedAt: Date(), unreadCount: 0, unreadMentionCount: 0,
                                           markedUnread: false, myAccess: .member, userMembers: [], coworkerMembers: [], sokoBotMembers: [])
    #expect(ComposerChannel.catalog(rooms: [room]).isEmpty)
    room.slug = "room"
    room.organizationName = "Partner"
    #expect(ComposerChannel.catalog(rooms: [room]).first?.organizationName == nil)
    room.myAccess = .guest
    #expect(ComposerChannel.catalog(rooms: [room]).first?.organizationName == "Partner")
    room.kind = .direct
    #expect(ComposerChannel.catalog(rooms: [room]).isEmpty)
  }
}

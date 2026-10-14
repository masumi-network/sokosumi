import Foundation
@testable import SokosumiChat
import Testing

/// What each deployment inserts after a channel's first segment (ADR 0055, `@sokosumi/utils` `ably-channel.ts`):
/// nothing in production, the network and URL-encoded Git ref on a preview, the network in development.
private let scopes = ["", "preview:mainnet:branch_fix%2Fsoko-bot-inbox-paging:", "development:preprod:"]

private func channel(_ namespace: String, _ scope: String, _ last: String) -> String {
  "\(namespace):\(scope)\(last)"
}

private func capability(_ grants: [String: [String]]) throws -> String {
  try String(bytes: JSONSerialization.data(withJSONObject: grants, options: .sortedKeys), encoding: .utf8) ?? ""
}

/// Room, chat control, typing and presence channels are read from the token, so a build pointed at a preview or a
/// local Core keeps realtime, and production names stay byte for byte.
struct RealtimeChannelScopeTests {
  @Test(arguments: scopes)
  func roomChannelsComeFromTheGrant(_ scope: String) throws {
    let roomA = channel("chat_rooms", scope, "room_a")
    let granted = try capability([
      roomA: ["subscribe"],
      channel("chat_rooms", scope, "room_b"): ["publish"],
      channel("chat_control", scope, "user_me"): ["subscribe"]
    ])
    #expect(chatRoomChannelNames(grantedSubscribeIn: granted) == ["a": roomA])
    #expect(parseChatRoomId(fromChannelName: roomA) == "a")
    #expect(parseChatRoomId(fromChannelName: channel("chat_rooms", scope, "room_")) == nil)
    #expect(parseChatRoomId(fromChannelName: channel("chat_typing", scope, "room_a")) == nil)
  }

  @Test(arguments: scopes)
  func chatControlChannelComesFromTheGrant(_ scope: String) throws {
    let control = channel("chat_control", scope, "user_me")
    let granted = try capability([control: ["subscribe"], channel("chat_rooms", scope, "room_a"): ["subscribe"]])
    #expect(userChatControlChannelName(grantedSubscribeIn: granted, userId: "me") == control)
    #expect(isUserChatControlChannel(control))
    // Another user's channel, a grant without subscribe, no user: never attach on a guess.
    #expect(userChatControlChannelName(grantedSubscribeIn: granted, userId: "other") == nil)
    #expect(try userChatControlChannelName(grantedSubscribeIn: capability([control: ["publish"]]), userId: "me") == nil)
    #expect(userChatControlChannelName(grantedSubscribeIn: granted, userId: "") == nil)
  }

  @Test(arguments: scopes)
  func typingChannelComesFromTheGrant(_ scope: String) throws {
    let typing = channel("chat_typing", scope, "room_a")
    let granted = try capability([typing: ["publish", "subscribe"], channel("chat_rooms", scope, "room_a"): ["subscribe"]])
    #expect(chatTypingGrant(in: granted, roomId: "a") == ChatTypingGrant(channelName: typing, canPublish: true))
    #expect(chatTypingGrant(in: granted, roomId: "b") == nil)
  }

  @Test(arguments: scopes)
  func presenceChannelComesFromTheGrant(_ scope: String) throws {
    let presence = channel("presence", scope, "org_org_1")
    let granted = try capability([presence: ["presence", "subscribe"], channel("presence", scope, "org_org_2"): ["subscribe"]])
    #expect(orgPresenceChannelNames(grantedPresenceIn: granted) == ["org_1": presence])
  }

  @Test func productionNamesAreUnchanged() {
    #expect(chatRoomChannelName(roomId: "abc") == "chat_rooms:room_abc")
    let production = #"""
    {"chat_rooms:room_abc":["subscribe"],"chat_control:user_u1":["subscribe"],\#
    "chat_typing:room_abc":["publish","subscribe"],"presence:org_o1":["presence","subscribe"]}
    """#
    #expect(chatRoomChannelNames(grantedSubscribeIn: production) == ["abc": "chat_rooms:room_abc"])
    #expect(userChatControlChannelName(grantedSubscribeIn: production, userId: "u1") == "chat_control:user_u1")
    #expect(chatTypingGrant(in: production, roomId: "abc")?.channelName == "chat_typing:room_abc")
    #expect(orgPresenceChannelNames(grantedPresenceIn: production) == ["o1": "presence:org_o1"])
  }

  @Test func theAllOperationsGrantCountsAsEveryOperation() {
    let all = #"{"chat_rooms:room_a":["*"],"chat_typing:room_a":["*"],"presence:org_o1":["*"],"chat_control:user_u1":["*"]}"#
    #expect(chatRoomChannelNames(grantedSubscribeIn: all) == ["a": "chat_rooms:room_a"])
    #expect(chatTypingGrant(in: all, roomId: "a") == ChatTypingGrant(channelName: "chat_typing:room_a", canPublish: true))
    #expect(orgPresenceChannelNames(grantedPresenceIn: all) == ["o1": "presence:org_o1"])
    #expect(userChatControlChannelName(grantedSubscribeIn: all, userId: "u1") == "chat_control:user_u1")
  }

  @Test func wildcardsAndOtherNamespacesNameNoChannel() {
    #expect(realtimeChannelId(in: "chat_typing:*", namespace: "chat_typing", kind: "room") == nil)
    #expect(realtimeChannelId(in: "presence:*", namespace: "presence", kind: "org") == nil)
    #expect(realtimeChannelId(in: "chat_rooms_extra:room_a", namespace: "chat_rooms", kind: "room") == nil)
    #expect(!isUserChatControlChannel("notifications:all:user_u1"))
  }
}

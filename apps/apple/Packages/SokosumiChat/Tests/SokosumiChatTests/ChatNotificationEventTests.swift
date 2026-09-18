import Foundation
import SokosumiChat
import Testing

private func payload(_ overrides: [String: Any] = [:], params: [String: Any] = ["authorName": "Ada", "roomName": "design"]) -> [String: Any] {
  var value: [String: Any] = [
    "id": "n1", "userId": "user_1", "kind": "CHAT", "referenceId": "room_1", "eventId": "m1",
    "messageKey": "Notifications.Chat.mentioned", "messageParams": params,
    "metadata": ["messageId": " m1 ", "workspaceId": "ws_1"],
    "isRead": false, "readAt": NSNull(), "createdAt": "2026-09-18T10:00:00.000Z"
  ]
  value.merge(overrides) { _, new in new }
  return value
}

struct ChatNotificationEventTests {
  @Test func channelNameComesFromTheGrantedCapability() {
    let production = #"{"notifications:all:user_u1":["subscribe","push-subscribe"],"chat_control:user_u1":["subscribe"]}"#
    #expect(userNotificationsChannelName(grantedSubscribeIn: production, userId: "u1") == "notifications:all:user_u1")
    let preview = #"{"notifications:preview:preprod:branch_feat%2Fx:user_u1":["subscribe"]}"#
    #expect(userNotificationsChannelName(grantedSubscribeIn: preview, userId: "u1") == "notifications:preview:preprod:branch_feat%2Fx:user_u1")
    // Another user's channel, a grant without subscribe, a missing or malformed capability: never attach on a guess.
    #expect(userNotificationsChannelName(grantedSubscribeIn: production, userId: "u2") == nil)
    #expect(userNotificationsChannelName(grantedSubscribeIn: #"{"notifications:all:user_u1":["push-subscribe"]}"#, userId: "u1") == nil)
    #expect(userNotificationsChannelName(grantedSubscribeIn: nil, userId: "u1") == nil)
    #expect(userNotificationsChannelName(grantedSubscribeIn: "nope", userId: "u1") == nil)
    #expect(userNotificationsChannelName(grantedSubscribeIn: production, userId: "") == nil)
  }

  @Test func decodesAChatRowWithWebDefaults() throws {
    let event = try #require(ChatNotificationEvent(payload: payload()))
    #expect(event.id == "n1" && event.roomId == "room_1" && event.messageId == "m1" && event.workspaceId == "ws_1")
    #expect(!event.isRead && event.readAt == nil && event.osBanner && event.groupCount == nil)
    #expect(event.createdAt == Date(timeIntervalSince1970: 1_789_725_600))
    #expect(event.bannerIdentifier == ChatNotificationEvent.bannerIdentifier(roomId: "room_1"))
    #expect(event.bannerIdentifier == "sokosumi-room:room_1")
    let read = try #require(ChatNotificationEvent(payload: payload([
      "isRead": true, "readAt": "2026-09-18T10:05:00Z", "osBanner": false, "groupCount": 3, "metadata": NSNull()
    ])))
    #expect(read.isRead && read.readAt != nil && !read.osBanner && read.groupCount == 3 && read.messageId == nil && read.workspaceId == nil)
  }

  @Test func rejectsOtherKindsAndMalformedPayloads() {
    #expect(ChatNotificationEvent(payload: payload(["kind": "JOB"])) == nil)
    #expect(ChatNotificationEvent(payload: payload(["isRead": 1])) == nil)
    #expect(ChatNotificationEvent(payload: payload(["osBanner": "yes"])) == nil)
    #expect(ChatNotificationEvent(payload: payload(["groupCount": 0])) == nil)
    #expect(ChatNotificationEvent(payload: payload(["groupCount": 1.5])) == nil)
    #expect(ChatNotificationEvent(payload: payload(["referenceId": ""])) == nil)
    #expect(ChatNotificationEvent(payload: payload(["metadata": "x"])) == nil)
    #expect(ChatNotificationEvent(payload: "text") == nil)
  }

  @Test func bannerNamesWhoWroteAndWhere() {
    var event = ChatNotificationEvent(id: "n", roomId: "r", messageKey: "Notifications.Chat.mentioned",
                                      authorName: "Ada", roomName: "design", messagePreview: "hi @all, and @allison")
    #expect(event.banner.title == "Ada mentioned you in design")
    #expect(event.banner.body == "hi @Everyone, and @allison")
    event.isDirect = true
    #expect(event.banner.title == "Ada")
    event = .init(id: "n", roomId: "r", messageKey: "Notifications.Chat.directMessage", authorName: "Ada", roomName: "Ada")
    #expect(event.banner.title == "Ada" && event.banner.body.isEmpty)
    event = .init(id: "n", roomId: "r", messageKey: "Notifications.Chat.roomMessage", authorName: "Ada", roomName: "design", messagePreview: "ship it")
    #expect(event.banner.title == "Ada in channel design" && event.banner.body == "ship it")
    event.isGroup = true
    #expect(event.banner.title == "Ada in group design")
    event.roomName = " "
    #expect(event.banner.title == "Ada")
    // No author to name: the app title and the notification's own sentence.
    event = .init(id: "n", roomId: "r", messageKey: "Notifications.Chat.roomMessage", roomName: "design")
    #expect(event.banner.title == "Sokosumi" && event.banner.body == " wrote in channel design")
  }

  @Test func groupedBannerCarriesTheRoomCount() {
    var event = ChatNotificationEvent(id: "n", roomId: "r", messageKey: "Notifications.Chat.roomMessage",
                                      authorName: "Ada", roomName: "design", messagePreview: "latest", groupCount: 4)
    #expect(event.banner.title == "Sokosumi" && event.banner.body == "4 messages in channel design")
    event.isGroup = true
    #expect(event.banner.body == "4 messages in group design")
    event = .init(id: "n", roomId: "r", messageKey: "Notifications.Chat.directMessage", authorName: "Ada", groupCount: 2)
    #expect(event.banner.body == "2 messages from Ada")
    event = .init(id: "n", roomId: "r", messageKey: "Notifications.Chat.mentioned", authorName: "Ada", roomName: "Ada", isDirect: true, groupCount: 2)
    #expect(event.banner.body == "2 messages from Ada")
    // One waiting message names the arrival; a follow-up is never counted.
    event.groupCount = 1
    #expect(event.banner.title == "Ada")
    event = .init(id: "n", roomId: "r", messageKey: "Notifications.Chat.mentionedFollowUp", authorName: "Ada", roomName: "design", groupCount: 5)
    #expect(event.banner.title == "Sokosumi" && event.banner.body == "Ada is still waiting for you in design")
  }

  @Test func targetSurvivesTheUserInfoRoundTrip() {
    let target = ChatNotificationTarget(id: "n1", roomId: "room_1", messageId: "m1", workspaceId: "ws_1")
    #expect(ChatNotificationTarget(userInfo: target.userInfo) == target)
    let bare = ChatNotificationTarget(id: "n1", roomId: "room_1")
    #expect(ChatNotificationTarget(userInfo: bare.userInfo) == bare)
    #expect(ChatNotificationTarget(userInfo: ["id": "n1"]) == nil)
  }
}

struct ChatNotificationBannersTests {
  private func event(id: String = "n1", room: String = "room_1", read: Bool = false, readAt: Date? = nil,
                     createdAt: Date? = Date(timeIntervalSince1970: 100), osBanner: Bool = true, count: Int? = nil) -> ChatNotificationEvent {
    .init(id: id, roomId: room, messageKey: "Notifications.Chat.roomMessage", authorName: "Ada", roomName: "design",
          isRead: read, readAt: readAt, createdAt: createdAt, osBanner: osBanner, groupCount: count)
  }

  @Test func showsOnlyWhenWantedPermittedAndUnfocused() {
    var banners = ChatNotificationBanners()
    #expect(banners.handle(event(), isFocused: true, authorization: .authorized) == .none)
    #expect(banners.handle(event(), isFocused: false, authorization: .denied) == .none)
    #expect(banners.handle(event(), isFocused: false, authorization: .notDetermined) == .none)
    #expect(banners.handle(event(osBanner: false), isFocused: false, authorization: .authorized) == .none)
    #expect(banners.handle(event(), isFocused: false, authorization: .authorized) == .show(event().banner))
  }

  @Test func oneBannerPerRoomCarriesTheWaitingCount() {
    var banners = ChatNotificationBanners()
    guard case let .show(first) = banners.handle(event(), isFocused: false, authorization: .authorized),
          case let .show(second) = banners.handle(event(count: 2), isFocused: false, authorization: .authorized),
          case let .show(other) = banners.handle(event(id: "n9", room: "room_2"), isFocused: false, authorization: .authorized) else {
      Issue.record("expected three banners")
      return
    }
    #expect(first.identifier == second.identifier && second.body == "2 messages in channel design")
    #expect(other.identifier != first.identifier)
  }

  @Test func readRowTakesTheBannerDownBeforeTheGates() {
    var banners = ChatNotificationBanners()
    _ = banners.handle(event(), isFocused: false, authorization: .authorized)
    // Focused, permission gone, banner channel off: a read row still clears.
    let read = event(read: true, readAt: Date(timeIntervalSince1970: 200), osBanner: false)
    #expect(banners.handle(read, isFocused: true, authorization: .denied) == .dismiss(identifier: "sokosumi-room:room_1"))
    #expect(banners.handle(read, isFocused: true, authorization: .denied) == .none)
  }

  @Test func oldReadDoesNotClearANewerArrival() {
    var banners = ChatNotificationBanners()
    _ = banners.handle(event(id: "n2", createdAt: Date(timeIntervalSince1970: 300)), isFocused: false, authorization: .authorized)
    #expect(banners.handle(event(id: "n1", read: true, readAt: Date(timeIntervalSince1970: 200)), isFocused: false, authorization: .authorized) == .none)
    // Equal timestamps cannot order different rows; the row itself always clears, even without a read time.
    #expect(banners.handle(event(id: "n1", read: true, readAt: Date(timeIntervalSince1970: 300)), isFocused: false, authorization: .authorized) == .none)
    #expect(banners.handle(event(id: "n2", read: true), isFocused: false, authorization: .authorized) == .dismiss(identifier: "sokosumi-room:room_1"))
  }

  @Test func openedAndClearedBannersAreForgotten() {
    var banners = ChatNotificationBanners()
    _ = banners.handle(event(), isFocused: false, authorization: .authorized)
    banners.forget(roomId: "room_1")
    #expect(banners.handle(event(read: true), isFocused: false, authorization: .authorized) == .none)
    _ = banners.handle(event(), isFocused: false, authorization: .authorized)
    banners.removeAll()
    #expect(banners.handle(event(read: true), isFocused: false, authorization: .authorized) == .none)
  }
}

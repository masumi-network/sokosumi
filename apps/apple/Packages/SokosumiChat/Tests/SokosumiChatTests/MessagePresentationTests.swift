import CoreAPI
import Foundation
import SokosumiChat
import Testing

private let ada = "550e8400-e29b-41d4-a716-446655440201"
private let bob = "550e8400-e29b-41d4-a716-446655440202"

private func senderAda() -> String {
  testUserSender(name: "Ada", email: "ada@example.com")
}

private func utcCalendar() -> Calendar {
  var calendar = Calendar(identifier: .gregorian)
  calendar.timeZone = TimeZone(secondsFromGMT: 0) ?? calendar.timeZone
  return calendar
}

struct MessagePresentationTests {
  @Test func continuationNeedsSameSenderShortGap() async throws {
    let messages = try await fetchTestMessages([
      testMessageJSON(id: ada, content: "one", sender: senderAda(), createdAt: "2026-09-08T12:00:00.000Z"),
      testMessageJSON(id: bob, content: "two", sender: senderAda(), createdAt: "2026-09-08T12:01:00.000Z")
    ])
    #expect(isMessageContinuation(previous: nil, current: messages[0], calendar: utcCalendar()) == false)
    #expect(isMessageContinuation(previous: messages[0], current: messages[1], calendar: utcCalendar()) == true)
  }

  @Test func continuationBreaksOnSenderGapAndDay() async throws {
    let other = "{\"type\":\"coworker\",\"coworker\":{\"id\":\"cw_1\",\"name\":\"Helper\",\"slug\":\"helper\",\"presence\":\"online\"}}"
    let messages = try await fetchTestMessages([
      testMessageJSON(id: ada, content: "one", sender: senderAda(), createdAt: "2026-09-08T12:00:00.000Z"),
      testMessageJSON(id: bob, content: "other sender", sender: other, createdAt: "2026-09-08T12:01:00.000Z"),
      testMessageJSON(id: "550e8400-e29b-41d4-a716-446655440203", content: "late", sender: senderAda(), createdAt: "2026-09-08T12:06:00.000Z"),
      testMessageJSON(id: "550e8400-e29b-41d4-a716-446655440204", content: "next day", sender: senderAda(), createdAt: "2026-09-09T12:00:00.000Z"),
      testMessageJSON(id: "550e8400-e29b-41d4-a716-446655440205", content: "unknown", sender: "{\"type\":\"unknown\"}", createdAt: "2026-09-09T12:01:00.000Z")
    ])
    let calendar = utcCalendar()
    #expect(isMessageContinuation(previous: messages[0], current: messages[1], calendar: calendar) == false)
    #expect(isMessageContinuation(previous: messages[0], current: messages[2], calendar: calendar) == false)
    #expect(isMessageContinuation(previous: messages[2], current: messages[3], calendar: calendar) == false)
    #expect(isMessageContinuation(previous: messages[3], current: messages[4], calendar: calendar) == false)
  }

  @Test func continuationNeverCrossesMembershipRows() async throws {
    let join = "{\"action\":\"joined\",\"subject\":{\"type\":\"user\",\"id\":\"user_2\",\"name\":\"Ada\"}}"
    let messages = try await fetchTestMessages([
      testMessageJSON(id: ada, content: "before", sender: senderAda(), createdAt: "2026-09-08T12:00:00.000Z"),
      testMessageJSON(id: bob, content: "", sender: senderAda(), createdAt: "2026-09-08T12:01:00.000Z", membership: join)
    ])
    let calendar = utcCalendar()
    #expect(isMessageContinuation(previous: messages[0], current: messages[1], calendar: calendar) == false)
    #expect(isMessageContinuation(previous: messages[1], current: messages[0], calendar: calendar) == false)
  }

  @Test func daySeparatorLabels() {
    let calendar = utcCalendar()
    let now = Date(timeIntervalSince1970: 1_788_868_800) // 2026-09-08T12:00:00Z, a Tuesday
    func date(_ iso: String) -> Date {
      let formatter = ISO8601DateFormatter()
      formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
      return formatter.date(from: iso) ?? Date.distantPast
    }
    #expect(daySeparatorLabel(for: date("2026-09-08T09:00:00.000Z"), previous: nil, now: now, calendar: calendar) == "Today")
    #expect(daySeparatorLabel(for: date("2026-09-08T09:01:00.000Z"), previous: date("2026-09-08T09:00:00.000Z"), now: now, calendar: calendar) == nil)
    #expect(daySeparatorLabel(for: date("2026-09-07T23:00:00.000Z"), previous: nil, now: now, calendar: calendar) == "Yesterday")
    #expect(daySeparatorLabel(for: date("2026-09-05T12:00:00.000Z"), previous: nil, now: now, calendar: calendar) == "Saturday")
    #expect(daySeparatorLabel(for: date("2026-08-29T12:00:00.000Z"), previous: nil, now: now, calendar: calendar) == "29/08/2026")
  }

  @Test func membershipStatusRowText() async throws {
    let messages = try await fetchTestMessages([
      testMessageJSON(id: ada, content: "", sender: senderAda(), membership: "{\"action\":\"joined\",\"subject\":{\"type\":\"user\",\"id\":\"user_2\",\"name\":\"Ada\"}}"),
      testMessageJSON(id: bob, content: "", sender: senderAda(), membership: "{\"action\":\"left\",\"subject\":{\"type\":\"coworker\",\"id\":\"cw_1\",\"name\":\"Helper\"}}"),
      testMessageJSON(id: "550e8400-e29b-41d4-a716-446655440206", content: "", sender: senderAda(), membership: "{\"action\":\"joined\",\"subject\":{\"type\":\"sokoBot\",\"id\":\"bot_1\",\"name\":\"Soko\"}}"),
      testMessageJSON(id: "550e8400-e29b-41d4-a716-446655440207", content: "plain", sender: senderAda())
    ])
    #expect(membershipStatusText(messages[0]) == "Ada joined")
    #expect(membershipStatusText(messages[1]) == "Helper left")
    #expect(membershipStatusText(messages[2]) == "Soko joined")
    #expect(membershipStatusText(messages[3]) == nil)
  }

  @Test func groupNameChangeRowsAreStatusRows() async throws {
    let unknown = "{\"type\":\"unknown\"}"
    let messages = try await fetchTestMessages([
      testMessageJSON(id: ada, content: "Ada named the group Launch crew", sender: unknown,
                      groupNameChange: "{\"action\":\"named\",\"name\":\"Launch crew\",\"actor\":{\"id\":\"user_1\",\"name\":\"Ada\"}}"),
      testMessageJSON(id: bob, content: "Ada removed the group name", sender: unknown,
                      groupNameChange: "{\"action\":\"cleared\",\"name\":null,\"actor\":{\"id\":\"user_1\",\"name\":\"Ada\"}}"),
      testMessageJSON(id: "550e8400-e29b-41d4-a716-446655440208", content: "plain", sender: senderAda())
    ])
    #expect(GroupNameChangeStatus(messages[0]) == .named(actor: "Ada", name: "Launch crew"))
    #expect(GroupNameChangeStatus(messages[1]) == .cleared(actor: "Ada"))
    #expect(GroupNameChangeStatus(messages[2]) == nil)
    for status in messages.prefix(2) {
      #expect(isRoomStatusMessage(status))
      #expect(membershipStatusText(status) == nil)
      #expect(!canReactToMessage(status))
      #expect(!canQuoteMessage(status))
      #expect(!canModifyOwnMessage(status, userId: "user_1"))
      #expect(shouldKeepPersistedMessage(status))
      #expect(!isMessageContinuation(previous: messages[2], current: status, calendar: utcCalendar()))
      #expect(!isMessageContinuation(previous: status, current: messages[2], calendar: utcCalendar()))
    }
    #expect(!isRoomStatusMessage(messages[2]))
  }

  @Test func initialsFallback() {
    #expect(initials(for: "Ada Lovelace") == "AL")
    #expect(initials(for: "ada lovelace") == "AL")
    #expect(initials(for: "Ada") == "A")
    #expect(initials(for: "") == "?")
    #expect(initials(for: "  ") == "?")
  }

  // Web `unfurlCardHasPreviewContent` (packages/utils/src/unfurl-urls.test.ts), case for case.

  @Test func unfurlCardHasPreviewContentIsFalseForTitleOnlyCards() {
    #expect(unfurlCardHasPreviewContent(unfurlCard(imageUrl: nil, description: nil)) == false)
    #expect(unfurlCardHasPreviewContent(unfurlCard(imageUrl: "  ", description: "  ")) == false)
  }

  @Test func unfurlCardHasPreviewContentIsTrueWhenAnImageOrDescriptionIsPresent() {
    #expect(unfurlCardHasPreviewContent(unfurlCard(imageUrl: "https://cdn.example/i.png", description: nil)) == true)
    #expect(unfurlCardHasPreviewContent(unfurlCard(imageUrl: nil, description: "A short summary")) == true)
  }

  private func unfurlCard(imageUrl: String?, description: String?) -> Components.Schemas.ChatRoomMessageUnfurl {
    .init(url: "https://example.com/article", title: "Example Article", description: description, imageUrl: imageUrl, siteName: "Example")
  }
}

import CoreAPI
import Foundation
import OpenAPIRuntime
@testable import SokosumiChat
import Testing

/// Each message's row in a Transcript list, as the room and the Thread lay it out: the gap and day pill above it,
/// then a status row or a bubble.
@MainActor
struct TranscriptRowTests {
  private let now = Date(timeIntervalSince1970: 1_788_868_800) // 2026-09-08T12:00:00Z
  private let context = TranscriptContext(room: nil, viewerId: "ada", allowsPins: false, allowsThreads: true)

  private func ada(_ id: String, _ content: String, at date: String, membership: String? = nil) -> String {
    testMessageJSON(id: id, content: content, sender: testUserSender(name: "Ada", email: "ada@example.com"), createdAt: date,
                    membership: membership)
  }

  private func client(_ transport: some ClientTransport) -> Client {
    Client.core(baseURL: URL(string: "https://core.example/v1")!, transport: transport)
  }

  @Test func aStatusMessageIsAStatusRowAndTheDayPillFollowsTheCalendar() async throws {
    let join = #"{"action":"joined","subject":{"type":"user","id":"user_2","name":"Bob"}}"#
    let messages = try await fetchTestMessages([
      ada("m1", "Monday", at: "2026-09-07T10:00:00.000Z"),
      ada("m2", "", at: "2026-09-07T10:01:00.000Z", membership: join),
      ada("m3", "Tuesday", at: "2026-09-08T09:00:00.000Z")
    ])
    let session = TranscriptSession()
    let rows = messages.indices.map { session.row(at: $0, of: messages, context: context, streamBusy: false, now: now) }
    #expect(rows.map(\.dayLabel) == ["Yesterday", nil, "Today"])
    #expect(rows[1].content == .status)
    #expect(rows.allSatisfy { $0.gap == nil })
  }

  /// A gap resets the avatar grouping but keeps the day: messages missing between two of the same day are of it too.
  @Test func aGapRowResetsTheGroupingButNotTheDay() async throws {
    let transport = TestTransport([
      (200, testMessagesPageBody(messages: [ada("z", "Latest", at: testTimestamp)], nextCursor: "z")),
      (200, testMessagesPageBody(messages: [ada("a", "Pinned", at: testTimestamp)], nextCursor: "a")),
      (200, testMessagesPageBody(messages: [ada("zz", "Live", at: testTimestamp)], nextCursor: "zz"))
    ])
    let session = TranscriptSession()
    session.timeline.reset(roomId: testRoomId)
    for page in [RoomTimeline.Page.initial, .around("a"), .latest] {
      _ = try await session.timeline.loadPage(page, client: client(transport), organizationSlug: nil, generation: session.timeline.generation)
    }
    let messages = session.timeline.messages
    #expect(messages.map(\.id) == ["a", "z", "zz"])
    let gapRow = session.row(at: 1, of: messages, context: context, streamBusy: false, now: now)
    #expect(gapRow.gap == .idle)
    #expect(gapRow.dayLabel == nil, "Same day as the row above, across the gap.")
    guard case let .bubble(bubble) = gapRow.content else { Issue.record("expected a bubble")
      return
    }
    #expect(!bubble.row.isContinuation, "The same sender a minute later still starts a new group after a gap.")
    #expect(bubble.row == MessageRow(messages[1], in: context, previous: nil, isNewest: false))
  }

  /// A coworker stream's reply shows its Thought working until words arrive; whitespace is not words.
  @Test func aStreamedReplyThinksUntilItHasWords() async throws {
    var reply = try #require(try await fetchTestMessages([ada("reply", "", at: testTimestamp)]).first)
    reply.id = "stream:reply"
    reply.content = "  \n"
    reply.sender = .case2(.init(_type: .coworker, coworker: .init(id: "cow_1", name: "Elena", slug: "elena", caption: nil, image: nil,
                                                                  presence: .online)))
    let session = TranscriptSession()
    func thinking(_ busy: Bool, _ message: Components.Schemas.ChatRoomMessage) -> Bool? {
      guard case let .bubble(bubble) = session.row(at: 0, of: [message], context: context, streamBusy: busy, now: now).content else {
        return nil
      }
      return bubble.thinking
    }
    #expect(thinking(true, reply) == true)
    #expect(thinking(false, reply) == false, "Nothing is working once the stream ended.")
    reply.content = "Done."
    #expect(thinking(true, reply) == false)
  }

  @Test func onlyTheNewestRowIsMarkedNewest() async throws {
    let messages = try await fetchTestMessages([
      ada("m1", "First", at: testTimestamp),
      ada("m2", "Second", at: "2026-01-01T00:05:00.000Z")
    ])
    let session = TranscriptSession()
    for index in messages.indices {
      let row = session.row(at: index, of: messages, context: context, streamBusy: false, newestId: "m2", now: now)
      guard case let .bubble(bubble) = row.content else { Issue.record("expected a bubble")
        return
      }
      let previous = index > 0 ? messages[index - 1] : nil
      #expect(bubble.row == MessageRow(messages[index], in: context, previous: previous, isNewest: index == 1))
    }
  }
}

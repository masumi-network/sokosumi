import CoreAPI
import Foundation
import SokosumiChat
import Testing

/// Mirrors web `room-helpers.skills.test.ts`, `skill-picker.test.tsx` and `skill-chip.test.tsx` (row 42).
private let viewer = Components.Schemas.ChatRoomUserParticipant(id: "me", name: "Me", email: "me@example.com", presence: .online)
private let peer = Components.Schemas.ChatRoomUserParticipant(id: "peer", name: "Peer", email: "peer@example.com", presence: .online)
private let coworker = Components.Schemas.ChatRoomCoworkerParticipant(id: "cow", name: "Helper", slug: "helper", presence: .online)
private let bot = Components.Schemas.ChatRoomSokoBotParticipant(id: "bot", name: "Assistant", caption: nil, ownerUserId: "me", presence: .offline)

private func room(
  _ kind: Components.Schemas.ChatRoom.KindPayload,
  users: [Components.Schemas.ChatRoomUserParticipant],
  coworkers: [Components.Schemas.ChatRoomCoworkerParticipant] = [],
  bots: [Components.Schemas.ChatRoomSokoBotParticipant] = []
) -> Components.Schemas.ChatRoom {
  .init(
    id: "room", name: "Room", kind: kind, isSelfDirect: false, isGroupDirect: false, isReadOnly: false,
    createdByUserId: "me", createdAt: .distantPast, updatedAt: .distantPast, unreadCount: 0, unreadMentionCount: 0,
    markedUnread: false, myAccess: .init(value1: .member, value2: "member"), userMembers: users,
    formerUserMembers: [], coworkerMembers: coworkers, sokoBotMembers: bots
  )
}

private let react = Components.Schemas.ChatSkillCatalogItem(
  id: "vercel-labs/agent-skills/react", name: "react", source: "vercel-labs/agent-skills", description: "React rules", installs: 1200
)
private let grill = Components.Schemas.ChatSkillCatalogItem(
  id: "mattpocock/skills/grill-me", name: "grill-me", source: "mattpocock/skills", description: nil, installs: 900
)

private func chip(_ index: Int) -> Components.Schemas.ChatRoomMessageSkill {
  .init(id: "a/b/\(index)", name: "skill-\(index)", description: nil, url: "https://skills.sh/a/b/\(index)")
}

struct MessageSkillsTests {
  // MARK: Where the button shows

  @Test func skillsAreOfferedOnlyWhereAnAgentReadsTheSend() {
    #expect(!MessageSkills.allowed(in: room(.channel, users: [viewer, peer, .init(id: "c", name: "C", email: "c@example.com", presence: .online)])))
    #expect(!MessageSkills.allowed(in: room(.direct, users: [viewer, peer])))
    #expect(MessageSkills.allowed(in: room(.channel, users: [viewer, peer], coworkers: [coworker])))
    #expect(MessageSkills.allowed(in: room(.direct, users: [viewer, peer], bots: [bot])))
    #expect(MessageSkills.allowed(in: room(.direct, users: [viewer], bots: [bot])))
    #expect(!MessageSkills.allowed(in: nil))
  }

  /// The coworker 1:1 runs on the room stream, whose send carries no skills.
  @Test func theCoworkerStreamRoomOffersNoSkills() {
    #expect(!MessageSkills.allowed(in: room(.direct, users: [viewer], coworkers: [coworker])))
    #expect(MessageSkills.allowed(in: room(.direct, users: [viewer, peer], coworkers: [coworker])))
  }

  // MARK: Picking

  @Test func aPickedSkillBecomesAChipLinkingItsSkillsShPage() {
    #expect(MessageSkills.chip(for: grill) == .init(
      id: "mattpocock/skills/grill-me", name: "grill-me", description: nil, url: "https://skills.sh/mattpocock/skills/grill-me"
    ))
    #expect(MessageSkills.chip(for: react).description == "React rules")
  }

  @Test func attachingSkipsADuplicateAndStopsAtThree() {
    let one = MessageSkills.attaching(chip(1), to: [])
    #expect(one == [chip(1)])
    #expect(MessageSkills.attaching(chip(1), to: one) == [chip(1)])
    let three = [chip(1), chip(2), chip(3)]
    #expect(MessageSkills.isFull(three))
    #expect(!MessageSkills.isFull([chip(1), chip(2)]))
    #expect(MessageSkills.attaching(chip(4), to: three) == three)
    #expect(MessageSkills.maxPerMessage == 3)
  }

  /// Web `format.number(installs, { notation: "compact" })` inside "{count} installs".
  @Test func installCountsReadCompact() {
    let locale = Locale(identifier: "en_US")
    #expect(MessageSkills.installsLabel(1200, locale: locale) == "1.2K installs")
    #expect(MessageSkills.installsLabel(900, locale: locale) == "900 installs")
    #expect(MessageSkills.installsLabel(761_642, locale: locale) == "762K installs")
    #expect(MessageSkills.installsLabel(1_234_567, locale: locale) == "1.2M installs")
  }

  // MARK: Search request

  @Test func searchAsksCoreForTheTopSkillsWithoutAQuery() async throws {
    let transport = TestTransport([(200, skillsBody([react, grill]))])
    let skills = try await ChatService().searchSkills(client: makeTestClient(transport), query: "   ")
    #expect(skills.map(\.id) == [react.id, grill.id])
    #expect(skills.map(\.installs) == [1200, 900])
    #expect(transport.requests.map(\.operationID) == ["searchChatSkills"])
    let request = try #require(transport.requests.first).request
    #expect(request.path?.hasSuffix("/chats/skills") == true)
    #expect(testRequestQuery(request).isEmpty)
  }

  /// Web's route trims the query and keeps its first 100 characters; Core refuses a longer one.
  @Test func searchSendsTheTrimmedQueryCappedAtCoresLimit() async throws {
    let transport = TestTransport([(200, skillsBody([react])), (200, skillsBody([]))])
    let client = try makeTestClient(transport)
    _ = try await ChatService().searchSkills(client: client, query: "  react ")
    _ = try await ChatService().searchSkills(client: client, query: String(repeating: "a", count: 140))
    #expect(transport.requests.map { testRequestQuery($0.request) } == ["q=react", "q=" + String(repeating: "a", count: 100)])
  }

  @Test func aSearchCoreRefusesIsAnError() async throws {
    let transport = TestTransport([(503, #"{"error":"Service Unavailable","message":"skills.sh is unavailable"}"#)])
    await #expect(throws: ChatServiceError.self) {
      _ = try await ChatService().searchSkills(client: makeTestClient(transport), query: "react")
    }
  }

  // MARK: Send

  @Test func aSendCarriesTheAttachedSkillIds() async throws {
    let transport = TestTransport([
      (201, testCreatedMessageBody(id: "550e8400-e29b-41d4-a716-446655440421", content: "Review this", clientMessageId: "turn-1")),
      (201, testCreatedMessageBody(id: "550e8400-e29b-41d4-a716-446655440422", content: "Plain", clientMessageId: "turn-2"))
    ])
    let client = try makeTestClient(transport)
    _ = try await ChatService().createMessage(
      client: client, roomId: testRoomId, content: "Review this", clientMessageId: "turn-1",
      skillIds: [react.id, grill.id], organizationSlug: nil
    )
    _ = try await ChatService().createMessage(
      client: client, roomId: testRoomId, content: "Plain", clientMessageId: "turn-2", organizationSlug: nil
    )
    #expect(testRequestJSON(transport.bodies[0])["skillIds"] as? [String] == [react.id, grill.id])
    #expect(testRequestJSON(transport.bodies[1])["skillIds"] == nil)
  }

  /// The pending shell shows the chips until Core confirms the message (web `createPendingRoomMessage`).
  @Test func thePendingShellShowsTheAttachedSkills() {
    let shell = OutboundShell(clientTurnId: "turn", roomId: "room", content: "Review this", skills: [chip(1)], createdAt: .distantPast, sender: viewer)
    #expect(chatRoomMessage(from: shell).skills == [chip(1)])
    let plain = OutboundShell(clientTurnId: "plain", roomId: "room", content: "Hi", createdAt: .distantPast, sender: viewer)
    #expect(chatRoomMessage(from: plain).skills == nil)
  }

  @Test func aMessageDecodesItsSkills() async throws {
    let json = testMessageJSON(id: "550e8400-e29b-41d4-a716-446655440423", content: "Review this", sender: testUserSender(name: "Ada", email: "ada@example.com"))
      .replacingOccurrences(of: #""unfurls":null"#, with: #""unfurls":null,"skills":[{"id":"a/b/1","name":"skill-1","description":null,"url":"https://skills.sh/a/b/1"}]"#)
    let messages = try await fetchTestMessages([json])
    #expect(messages.first?.skills == [chip(1)])
  }
}

private func skillsBody(_ items: [Components.Schemas.ChatSkillCatalogItem]) -> String {
  let rows = items.map { item in
    let description = item.description.map { "\"\($0)\"" } ?? "null"
    return #"{"id":"\#(item.id)","name":"\#(item.name)","source":"\#(item.source)","description":\#(description),"installs":\#(item.installs)}"#
  }
  return #"{"data":[\#(rows.joined(separator: ","))],"meta":{"timestamp":"\#(testTimestamp)","requestId":"req-1"}}"#
}

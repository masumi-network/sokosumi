import CoreAPI
import Foundation
import SokosumiChat
import Testing

struct CoworkerThoughtTests {
  @Test func persistedReasoningIgnoresAnswerAndToolParts() async throws {
    let metadata = #"{"reasoning":[{"type":"reasoning","text":" First "},{"type":"text","text":"Answer"},{"type":"tool-result","text":"Internal"},{"type":"reasoning","content":"Second"}],"thought_timing_ms":{"start":"1000","end":2500}}"#
    let row = testMessageJSON(id: "m", content: "Answer", sender: testUserSender(name: "Me", email: "me@example.com"), metadata: metadata)
    let messages = try await fetchTestMessages([row])
    let thought = try CoworkerThought(message: #require(messages.first))
    #expect(thought.text == "First\n\nSecond")
    #expect(thought.durationSeconds == 2)
  }

  @Test(arguments: [#"{"start":0,"end":1000}"#, #"{"start":2000,"end":1000}"#, #"{"start":"bad","end":1000}"#])
  func invalidTimingRemainsUnknown(timing: String) async throws {
    let row = testMessageJSON(id: "m", content: "Answer", sender: testUserSender(name: "Me", email: "me@example.com"), metadata: "{\"thought_timing_ms\":\(timing)}")
    let messages = try await fetchTestMessages([row])
    let thought = try CoworkerThought(message: #require(messages.first))
    #expect(thought.text.isEmpty)
    #expect(thought.durationSeconds == nil)
  }

  /// Row 09c: the trace's paragraphs, as web's `thoughtBeatSteps` splits the joined text on blank lines,
  /// trimmed and without empty ones. The live Thinking body stacks them.
  @Test func stepsAreTheTraceParagraphs() async throws {
    let metadata = #"{"reasoning":[{"type":"reasoning","text":"Reading the thread"},{"type":"reasoning","text":"  "},{"type":"reasoning","text":"Comparing the drafts\n\n\n Weighing the options "}]}"#
    let row = testMessageJSON(id: "m", content: "", sender: testUserSender(name: "Me", email: "me@example.com"), metadata: metadata)
    let thought = try await CoworkerThought(message: #require(fetchTestMessages([row]).first))
    #expect(thought.text == "Reading the thread\n\nComparing the drafts\n\n\n Weighing the options")
    #expect(thought.steps == ["Reading the thread", "Comparing the drafts", "Weighing the options"])
  }

  @Test func durationLabelsMatchWeb() {
    #expect(CoworkerThought.durationLabel(seconds: 3) == "3s")
    #expect(CoworkerThought.durationLabel(seconds: 63) == "1m 3s")
    #expect(CoworkerThought.durationLabel(seconds: 120) == "2m")
  }

  @Test func coworkerSenderIsTheCoworkerCase() async throws {
    let coworker = try await decode(id: "m", sender: coworkerSender)
    let bot = try await decode(id: "m", sender: sokoBotSender)
    let person = try await decode(id: "m", sender: testUserSender(name: "Me", email: "me@example.com"))
    var unknown = person
    unknown.sender = .case4(.init(_type: .unknown))
    #expect(isCoworkerSender(coworker))
    #expect(!isCoworkerSender(bot))
    #expect(!isCoworkerSender(person))
    #expect(!isCoworkerSender(unknown))
  }

  @Test func coworkerStreamOverlayNeedsTheStreamPrefixAndACoworker() async throws {
    let overlay = try await decode(id: "stream:turn", sender: coworkerSender)
    let persisted = try await decode(id: "m", sender: coworkerSender)
    let userTurn = try await decode(id: "stream:turn", sender: testUserSender(name: "Me", email: "me@example.com"))
    let botOverlay = try await decode(id: "stream:turn", sender: sokoBotSender)
    #expect(isCoworkerStreamOverlay(overlay))
    #expect(!isCoworkerStreamOverlay(persisted))
    #expect(!isCoworkerStreamOverlay(userTurn))
    #expect(!isCoworkerStreamOverlay(botOverlay))
  }
}

private let coworkerSender = #"{"type":"coworker","coworker":{"id":"cow_1","name":"Elena","slug":"elena","caption":null,"image":null,"presence":"online"}}"#
private let sokoBotSender = #"{"type":"sokoBot","sokoBot":{"id":"bot_1","name":"Soko","caption":"Me's personal assistant","image":null,"avatarSeed":"orb:user_2","ownerUserId":"user_2","presence":"online"}}"#

private func decode(id: String, sender: String) async throws -> Components.Schemas.ChatRoomMessage {
  try #require(try await fetchTestMessages([testMessageJSON(id: id, content: "", sender: sender)]).first)
}

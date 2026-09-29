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
}

import CoreAPI
import Foundation
import SokosumiChat
import Testing

struct CoworkerThoughtTests {
  @Test func persistedReasoningIgnoresAnswerAndToolParts() async throws {
    let metadata = #"{"reasoning":[{"type":"reasoning","text":" First "},{"type":"text","text":"Answer"},{"type":"tool-result","text":"Internal"},{"type":"reasoning","content":"Second"}],"thought_timing_ms":{"start":"1000","end":2500}}"#
    let row = testMessageJSON(id: "m", content: "Answer", sender: testUserSender(name: "Me", email: "me@example.com"), metadata: metadata)
    let messages = try await fetchTestMessages([row])
    let thought = try CoworkerThought(message: #require(messages.first), streamedText: "Fallback")
    #expect(thought.text == "First\n\nSecond")
    #expect(thought.durationSeconds == 2)
  }

  @Test(arguments: [#"{"start":0,"end":1000}"#, #"{"start":2000,"end":1000}"#, #"{"start":"bad","end":1000}"#])
  func invalidTimingRemainsUnknown(timing: String) async throws {
    let row = testMessageJSON(id: "m", content: "Answer", sender: testUserSender(name: "Me", email: "me@example.com"), metadata: "{\"thought_timing_ms\":\(timing)}")
    let messages = try await fetchTestMessages([row])
    let thought = try CoworkerThought(message: #require(messages.first), streamedText: " Live ")
    #expect(thought.text == "Live")
    #expect(thought.durationSeconds == nil)
  }

  @Test func durationLabelsMatchWeb() {
    #expect(CoworkerThought.durationLabel(seconds: 3) == "3s")
    #expect(CoworkerThought.durationLabel(seconds: 63) == "1m 3s")
    #expect(CoworkerThought.durationLabel(seconds: 120) == "2m")
  }
}

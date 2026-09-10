import Foundation

/// The visible text/reasoning subset of the AI SDK UI message protocol.
/// SSE framing belongs to OpenAPIRuntime; this consumes each JSON data event.
struct DirectStreamMessage: Sendable {
  private struct Event: Decodable {
    let type: String
    let messageId: String?
    let id: String?
    let delta: String?
    let errorText: String?
  }

  private struct Part: Sendable {
    let id: String
    let reasoning: Bool
    var text = ""
    var ended = false
  }

  private(set) var id: String?
  private(set) var finished = false
  private var parts: [Part] = []

  var text: String {
    parts.filter { !$0.reasoning }.map(\.text).joined()
  }

  var reasoning: String {
    parts.filter(\.reasoning).map(\.text).joined(separator: "\n\n")
  }

  var latestThought: String? {
    parts.last { $0.reasoning && !$0.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }?.text
  }

  mutating func receive(_ data: String) throws {
    let event = try JSONDecoder().decode(Event.self, from: Data(data.utf8))
    switch event.type {
    case "start":
      guard let messageId = event.messageId, !messageId.isEmpty else { throw invalidEvent(event.type) }
      id = messageId
    case "text-start", "reasoning-start":
      guard let partId = event.id else { throw invalidEvent(event.type) }
      let isReasoning = event.type == "reasoning-start"
      guard !parts.contains(where: { $0.id == partId && $0.reasoning == isReasoning }) else {
        throw invalidEvent(event.type)
      }
      parts.append(.init(id: partId, reasoning: isReasoning))
    case "text-delta", "reasoning-delta", "text-end", "reasoning-end":
      try updatePart(event)
    case "finish": finished = true
    case "error": throw ChatServiceError.unexpectedResponse(event.errorText ?? "The coworker response failed.")
    case "abort": throw ChatServiceError.unexpectedResponse("The coworker response was interrupted.")
    default:
      // Step boundaries, tools and sources don't contribute to web's plain
      // room overlay. Their richer rendering is a separate parity slice.
      break
    }
  }

  private mutating func updatePart(_ event: Event) throws {
    let isReasoning = event.type.hasPrefix("reasoning-")
    guard let index = parts.firstIndex(where: { $0.id == event.id && $0.reasoning == isReasoning }),
          !parts[index].ended else { throw invalidEvent(event.type) }
    if event.type.hasSuffix("-end") {
      parts[index].ended = true
    } else {
      guard let delta = event.delta else { throw invalidEvent(event.type) }
      parts[index].text += delta
    }
  }

  private func invalidEvent(_ type: String) -> ChatServiceError {
    .unexpectedResponse("Invalid coworker stream event: \(type).")
  }
}

import CoreAPI
import Foundation
import OpenAPIRuntime

/// The reasoning trace of a coworker message: live on a stream overlay or a
/// persisted mention shell, and the Thought disclosure once the answer is
/// there. Both read `metadata.reasoning`, which the stream overlay fills from
/// its reasoning parts as web's does, so one join rule serves every state.
public struct CoworkerThought: Sendable {
  /// Every non-empty reasoning beat, trimmed, joined by a blank line (web
  /// `extractThoughtTextFromMetadata`).
  public let text: String
  public let durationSeconds: Int?

  public init(message: Components.Schemas.ChatRoomMessage) {
    let metadata = message.metadata?.additionalProperties
    let steps = metadata?["reasoning"]?.value as? [[String: Any]] ?? []
    text = steps.compactMap { step -> String? in
      guard let type = step["type"] as? String, type.trimmingCharacters(in: .whitespacesAndNewlines) == "reasoning" else { return nil }
      let text = (step["text"] as? String ?? step["content"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
      return text.isEmpty ? nil : text
    }.joined(separator: "\n\n")
    let timing = metadata?["thought_timing_ms"]?.value as? [String: Any]
    if let start = Self.number(timing?["start"]), let end = Self.number(timing?["end"]), start > 0, end >= start {
      let seconds = ((end - start) / 1000).rounded()
      durationSeconds = seconds.isFinite && seconds < Double(Int.max) ? Int(seconds) : nil
    } else {
      durationSeconds = nil
    }
  }

  /// The trace's paragraphs (web `thoughtBeatSteps`): split on blank lines,
  /// trimmed, none empty. The live Thinking body stacks them.
  public var steps: [String] {
    text.split(separator: /\n\n+/).map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
  }

  /// `metadata.reasoning` for a stream overlay (web `reasoningStepsForMetadata`),
  /// nil without a reasoning part.
  static func metadata(reasoning parts: [String]) -> Components.Schemas.ChatRoomMessage.MetadataPayload? {
    guard !parts.isEmpty,
          let steps = try? OpenAPIValueContainer(unvalidatedValue: parts.map { ["type": "reasoning", "text": $0] })
    else { return nil }
    return .init(additionalProperties: ["reasoning": steps])
  }

  /// Epoch start of a live Thought from `thought_timing_ms.start` (web
  /// `extractThoughtStartedAtMs`). Nil when missing or not positive.
  public static func startedAt(metadata: [String: OpenAPIValueContainer]?) -> Date? {
    let timing = metadata?["thought_timing_ms"]?.value as? [String: Any]
    guard let start = number(timing?["start"]), start > 0 else { return nil }
    return Date(timeIntervalSince1970: start / 1000)
  }

  public static func durationLabel(seconds: Int) -> String {
    let seconds = max(0, seconds)
    if seconds < 60 {
      return "\(seconds)s"
    }
    let minutes = seconds / 60
    let remainder = seconds % 60
    return remainder == 0 ? "\(minutes)m" : "\(minutes)m \(remainder)s"
  }

  private static func number(_ value: Any?) -> Double? {
    let result: Double? = if let string = value as? String {
      Double(string.trimmingCharacters(in: .whitespacesAndNewlines))
    } else if let integer = value as? Int {
      Double(integer)
    } else if let integer = value as? Int64 {
      Double(integer)
    } else {
      value as? Double
    }
    return result.flatMap { $0.isFinite ? $0 : nil }
  }
}

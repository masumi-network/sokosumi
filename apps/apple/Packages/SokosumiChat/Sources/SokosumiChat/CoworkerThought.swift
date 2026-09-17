import CoreAPI
import Foundation
import OpenAPIRuntime

/// Reasoning disclosure shared by streamed and persisted coworker messages.
public struct CoworkerThought: Sendable {
  public let text: String
  public let durationSeconds: Int?

  public init(message: Components.Schemas.ChatRoomMessage, streamedText: String? = nil) {
    let metadata = message.metadata?.additionalProperties
    let steps = metadata?["reasoning"]?.value as? [[String: Any]] ?? []
    let persisted = steps.compactMap { step -> String? in
      guard let type = step["type"] as? String, type.trimmingCharacters(in: .whitespacesAndNewlines) == "reasoning" else { return nil }
      let text = (step["text"] as? String ?? step["content"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
      return text.isEmpty ? nil : text
    }.joined(separator: "\n\n")
    text = persisted.isEmpty ? (streamedText ?? "").trimmingCharacters(in: .whitespacesAndNewlines) : persisted
    let timing = metadata?["thought_timing_ms"]?.value as? [String: Any]
    if let start = Self.number(timing?["start"]), let end = Self.number(timing?["end"]), start > 0, end >= start {
      let seconds = ((end - start) / 1000).rounded()
      durationSeconds = seconds.isFinite && seconds < Double(Int.max) ? Int(seconds) : nil
    } else {
      durationSeconds = nil
    }
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

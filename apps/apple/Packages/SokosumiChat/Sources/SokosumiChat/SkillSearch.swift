import Combine
import CoreAPI
import Foundation

/// The skill picker's search (row 42, web `SkillPickerPanel`): the top skills as soon as the picker opens, each later
/// query after a 200 ms pause, the previous answer kept on screen while the next one loads, and Enter picking only
/// from the answer to what is typed. One instance lives as long as one open picker.
@MainActor
public final class SkillSearch: ObservableObject {
  public typealias Item = Components.Schemas.ChatSkillCatalogItem

  /// The one line the list shows in place of rows.
  public enum Placeholder: Equatable, Sendable {
    /// Web `Skills.loading` "Loading skills…".
    case loading
    /// Web `Skills.unavailable` "Skills could not be loaded. Try again.".
    case unavailable
    /// Web `Skills.noResults` "No skills found".
    case noResults
  }

  /// Web `SEARCH_DEBOUNCE_MS`.
  public static let debounce = Duration.milliseconds(200)

  @Published public private(set) var results: [Item] = []
  @Published private var isLoading = false
  @Published private var failed = false
  /// The normalized query `results` answer; nil until the first answer.
  @Published private var answered: String?

  private let sleep: (Duration) async throws -> Void
  private var generation = 0

  public init(sleep: @escaping (Duration) async throws -> Void = { try await Task.sleep(for: $0) }) {
    self.sleep = sleep
  }

  /// What Core is asked for: trimmed, at most 100 characters (web's route; Core refuses more).
  public nonisolated static func normalized(_ query: String) -> String {
    String(query.trimmingCharacters(in: .whitespacesAndNewlines).prefix(100))
  }

  public var placeholder: Placeholder? {
    guard results.isEmpty else { return nil }
    if failed {
      return .unavailable
    }
    return isLoading || answered == nil ? .loading : .noResults
  }

  /// Asks for `query` through `fetch`. The first search of a picker goes at once (web's debounce starts from the
  /// open query); later ones wait `debounce`, and a newer search or a cancelled task drops this one's answer.
  public func search(_ query: String, using fetch: (String) async throws -> [Item]) async {
    generation += 1
    let current = generation
    let query = Self.normalized(query)
    if current > 1 {
      do {
        try await sleep(Self.debounce)
      } catch {
        return
      }
      guard current == generation, !Task.isCancelled else { return }
    }
    isLoading = true
    failed = false
    defer {
      if current == generation {
        isLoading = false
      }
    }
    do {
      let items = try await fetch(query)
      guard current == generation, !Task.isCancelled else { return }
      results = items
      answered = query
    } catch {
      guard current == generation, !Task.isCancelled else { return }
      // Web's failed query has no data of its own, so the list empties to the error line.
      results = []
      answered = nil
      failed = true
    }
  }

  /// Web's Enter: the first result not yet attached, only once the results answer what is typed.
  public func firstPickable(for liveQuery: String, excluding attached: Set<String>) -> Item? {
    guard !isLoading, answered == Self.normalized(liveQuery) else { return nil }
    return results.first { !attached.contains($0.id) }
  }
}

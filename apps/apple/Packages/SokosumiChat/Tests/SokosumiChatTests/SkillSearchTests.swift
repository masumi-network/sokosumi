import CoreAPI
import Foundation
import SokosumiChat
import Testing

/// Web `SkillPickerPanel` (`skill-picker.tsx`, row 42): the top skills at once, a 200 ms debounce after that,
/// the last answer kept while a new one loads, and Enter picking only from the answer to what is typed.
@MainActor struct SkillSearchTests {
  private static func item(_ id: String, installs: Int = 10) -> Components.Schemas.ChatSkillCatalogItem {
    .init(id: "owner/repo/\(id)", name: id, source: "owner/repo", description: nil, installs: installs)
  }

  /// Records each debounce instead of waiting it out.
  private final class Sleeps {
    var durations: [Duration] = []
  }

  private static func search(_ sleeps: Sleeps) -> SkillSearch {
    SkillSearch(sleep: { sleeps.durations.append($0) })
  }

  @Test func theTopSkillsLoadAtOnceWhenThePickerOpens() async {
    let sleeps = Sleeps()
    let search = Self.search(sleeps)
    #expect(search.placeholder == .loading)
    var asked: [String] = []
    await search.search("", using: { query in
      asked.append(query)
      return [Self.item("react"), Self.item("grill-me")]
    })
    #expect(asked == [""])
    #expect(sleeps.durations.isEmpty)
    #expect(search.results.map(\.name) == ["react", "grill-me"])
    #expect(search.placeholder == nil)
  }

  @Test func laterQueriesWaitForTheDebounceAndAreTrimmed() async {
    let sleeps = Sleeps()
    let search = Self.search(sleeps)
    var asked: [String] = []
    await search.search("", using: { asked.append($0)
      return []
    })
    await search.search("  rea ", using: { asked.append($0)
      return [Self.item("react")]
    })
    #expect(sleeps.durations == [.milliseconds(200)])
    #expect(asked == ["", "rea"])
  }

  @Test func eachEmptyStateSaysWhy() async {
    let failing = Self.search(Sleeps())
    await failing.search("", using: { _ in throw ChatServiceError.unexpectedResponse("down") })
    #expect(failing.placeholder == .unavailable)
    #expect(failing.results.isEmpty)

    let empty = Self.search(Sleeps())
    await empty.search("", using: { _ in [] })
    #expect(empty.placeholder == .noResults)
  }

  /// Web keeps the previous answer on screen (`placeholderData`) while the next query loads.
  @Test func theLastAnswerStaysWhileTheNextLoads() async {
    let search = Self.search(Sleeps())
    await search.search("", using: { _ in [Self.item("react")] })
    var during: [String] = []
    var placeholderDuring: SkillSearch.Placeholder?
    await search.search("grill", using: { [search] _ in
      during = search.results.map(\.name)
      placeholderDuring = search.placeholder
      return [Self.item("grill-me")]
    })
    #expect(during == ["react"])
    #expect(placeholderDuring == nil)
    #expect(search.results.map(\.name) == ["grill-me"])
  }

  @Test func enterPicksTheFirstSkillNotYetAttached() async {
    let search = Self.search(Sleeps())
    await search.search("", using: { _ in [Self.item("react"), Self.item("grill-me")] })
    #expect(search.firstPickable(for: "", excluding: []).map(\.name) == "react")
    #expect(search.firstPickable(for: " ", excluding: ["owner/repo/react"]).map(\.name) == "grill-me")
    #expect(search.firstPickable(for: "", excluding: ["owner/repo/react", "owner/repo/grill-me"]) == nil)
  }

  /// Enter picks only from results for what is typed, not the previous query's.
  @Test func enterPicksNothingWhileTheAnswerIsForAnotherQuery() async {
    let search = Self.search(Sleeps())
    await search.search("", using: { _ in [Self.item("react")] })
    #expect(search.firstPickable(for: "gri", excluding: []) == nil)
    var pickableDuring: Components.Schemas.ChatSkillCatalogItem?
    await search.search("gri", using: { [search] _ in
      pickableDuring = search.firstPickable(for: "gri", excluding: [])
      return [Self.item("grill-me")]
    })
    #expect(pickableDuring == nil)
    #expect(search.firstPickable(for: "gri", excluding: []).map(\.name) == "grill-me")
  }

  /// A query typed over a slower one wins; the late answer is dropped.
  @Test func aSupersededAnswerIsDropped() async {
    let search = Self.search(Sleeps())
    await search.search("", using: { _ in [] })
    let (gate, open) = AsyncStream.makeStream(of: Void.self)
    let slow = Task {
      await search.search("re", using: { _ in
        for await _ in gate {
          break
        }
        return [Self.item("stale")]
      })
    }
    for _ in 0 ..< 100 {
      await Task.yield()
    }
    await search.search("react", using: { _ in [Self.item("react")] })
    open.yield()
    open.finish()
    await slow.value
    #expect(search.results.map(\.name) == ["react"])
    #expect(search.firstPickable(for: "react", excluding: []).map(\.name) == "react")
  }

  /// A cancelled debounce (the next keystroke) neither asks Core nor clears the answer on screen.
  @Test func aCancelledDebounceAsksNothing() async {
    let search = SkillSearch(sleep: { _ in throw CancellationError() })
    await search.search("", using: { _ in [Self.item("react")] })
    var asked = false
    await search.search("gr", using: { _ in asked = true
      return []
    })
    #expect(!asked)
    #expect(search.results.map(\.name) == ["react"])
  }
}

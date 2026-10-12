import Foundation
import SokosumiChat
import Testing

private let now = Date(timeIntervalSince1970: 1_790_251_200)
private let english = Locale(identifier: "en_US")

/// next-intl's `relativeTime`: the largest unit that fits, rounded like `Math.round` (half up), "now" only for
/// seconds, never "yesterday".
struct RelativeAgeTests {
  /// `style: "narrow"`, the Thread reply bar's age (row 24h).
  @Test(arguments: [
    (0, "now"), (-30, "30s ago"), (-89, "1m ago"), (-150, "2m ago"), (-3 * 3600, "3h ago"),
    (-86400, "1d ago"), (-14 * 86400, "2w ago"), (-90 * 86400, "3mo ago"), (-400 * 86400, "1y ago")
  ] as [(Double, String)])
  func narrowFollowsWeb(offset: Double, label: String) {
    #expect(relativeAgeLabel(since: now.addingTimeInterval(offset), now: now, unitsStyle: .abbreviated, locale: english) == label)
  }

  /// The default `long` style, a member's read time in the Members inspector (row 31b2, web
  /// `RosterMemberReadState`'s `format.relativeTime(lastReadAt)`).
  @Test(arguments: [
    (0, "now"), (-30, "30 seconds ago"), (-89, "1 minute ago"), (-150, "2 minutes ago"), (-3 * 3600, "3 hours ago"),
    (-86400, "1 day ago"), (-14 * 86400, "2 weeks ago"), (-90 * 86400, "3 months ago"), (-400 * 86400, "1 year ago")
  ] as [(Double, String)])
  func longFollowsWeb(offset: Double, label: String) {
    #expect(relativeAgeLabel(since: now.addingTimeInterval(offset), now: now, unitsStyle: .full, locale: english) == label)
  }
}

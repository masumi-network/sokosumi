import Foundation

/// Device-local clock preference, mirroring web's Account → Preferences
/// "Time format" (`sokosumi.timeformat` cookie: absent = Auto, `12h`, `24h`).
/// Like the cookie it belongs to this install, not to the account.
public enum TimeFormatPreference: String, CaseIterable, Identifiable, Sendable {
  case auto
  case twelveHour = "12h"
  case twentyFourHour = "24h"

  /// `UserDefaults` key for the app's `@AppStorage`; an unknown stored value reads as Auto.
  public static let defaultsKey = "sokosumi.time-format.v1"

  public var id: String {
    rawValue
  }

  /// What Auto resolves to for `locale`. `Locale.current` already carries the
  /// system's 24-hour override, which is what web's browser detection stands for.
  public static func detected(locale: Locale = .current) -> TimeFormatPreference {
    switch locale.hourCycle {
    case .zeroToTwentyThree, .oneToTwentyFour: .twentyFourHour
    default: .twelveHour
    }
  }

  /// Web's option labels; Auto names what it resolves to ("Auto (24-hour)").
  public func title(locale: Locale = .current) -> String {
    switch self {
    case .auto: "Auto (\(Self.detected(locale: locale).title()))"
    case .twelveHour: "12-hour"
    case .twentyFourHour: "24-hour"
    }
  }

  /// The one formatting decision: Auto keeps the system's locale untouched;
  /// an explicit choice only overrides its hour cycle (web `h12` / `h23`).
  public func locale(_ base: Locale = .current) -> Locale {
    let hourCycle: Locale.HourCycle
    switch self {
    case .auto: return base
    case .twelveHour: hourCycle = .oneToTwelve
    case .twentyFourHour: hourCycle = .zeroToTwentyThree
    }
    var components = Locale.Components(locale: base)
    components.hourCycle = hourCycle
    return Locale(components: components)
  }

  /// Wall-clock time of a message ("9:13 PM" / "21:13"), web `formats.dateTime.time`.
  public func time(_ date: Date, locale: Locale = .current, timeZone: TimeZone = .current) -> String {
    format(date, date: .omitted, locale: locale, timeZone: timeZone)
  }

  /// Abbreviated date plus clock time, for tooltips such as "Edited".
  public func dateTime(_ date: Date, locale: Locale = .current, timeZone: TimeZone = .current) -> String {
    format(date, date: .abbreviated, locale: locale, timeZone: timeZone)
  }

  private func format(_ value: Date, date: Date.FormatStyle.DateStyle, locale: Locale, timeZone: TimeZone) -> String {
    value.formatted(Date.FormatStyle(date: date, time: .shortened, locale: self.locale(locale), timeZone: timeZone))
  }
}

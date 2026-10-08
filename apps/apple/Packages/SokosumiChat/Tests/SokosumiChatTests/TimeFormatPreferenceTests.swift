import Foundation
@testable import SokosumiChat
import Testing

struct TimeFormatPreferenceTests {
  /// 2026-09-21 21:13:20 UTC.
  private let evening = Date(timeIntervalSince1970: 1_790_025_200)
  private let utc = TimeZone(identifier: "UTC") ?? .gmt

  @Test func rawValuesMatchWebCookieValues() {
    #expect(TimeFormatPreference.allCases.map(\.rawValue) == ["auto", "12h", "24h"])
    #expect(TimeFormatPreference(rawValue: "h23") == nil)
  }

  @Test func autoKeepsTheSystemLocaleUntouched() {
    let german = Locale(identifier: "de_DE")
    #expect(TimeFormatPreference.auto.locale(german) == german)
    #expect(TimeFormatPreference.auto.time(evening, locale: Locale(identifier: "en_US"), timeZone: utc).hasSuffix("PM"))
    #expect(TimeFormatPreference.auto.time(evening, locale: german, timeZone: utc) == "21:13")
  }

  @Test(arguments: ["en_US", "de_DE", "en_GB", "ja_JP"])
  func explicitChoicesForceTheHourCycle(identifier: String) {
    let locale = Locale(identifier: identifier)
    #expect(TimeFormatPreference.twentyFourHour.time(evening, locale: locale, timeZone: utc) == "21:13")
    let twelve = TimeFormatPreference.twelveHour.time(evening, locale: locale, timeZone: utc)
    #expect(twelve.contains("9:13") && !twelve.contains("21"))
    #expect(TimeFormatPreference.twelveHour.locale(locale).hourCycle == .oneToTwelve)
    #expect(TimeFormatPreference.twentyFourHour.locale(locale).hourCycle == .zeroToTwentyThree)
  }

  @Test func dateTimeCarriesTheSameClock() {
    let locale = Locale(identifier: "en_US")
    #expect(TimeFormatPreference.twentyFourHour.dateTime(evening, locale: locale, timeZone: utc) == "Sep 21, 2026 at 21:13")
    #expect(TimeFormatPreference.twelveHour.dateTime(evening, locale: Locale(identifier: "de_DE"), timeZone: utc).contains("9:13"))
  }

  /// Row 38h2: web's `dateTimeShort` (`dateStyle: short, timeStyle: short`), as Node's Intl writes it for the same
  /// instant.
  @Test func shortDateTimeIsWebsDateTimeShort() {
    #expect(TimeFormatPreference.twentyFourHour.shortDateTime(evening, locale: Locale(identifier: "en_US"), timeZone: utc) == "9/21/26, 21:13")
    #expect(TimeFormatPreference.twelveHour.shortDateTime(evening, locale: Locale(identifier: "en_US"), timeZone: utc) == "9/21/26, 9:13\u{202F}PM")
    #expect(TimeFormatPreference.auto.shortDateTime(evening, locale: Locale(identifier: "de_DE"), timeZone: utc) == "21.09.26, 21:13")
    #expect(TimeFormatPreference.twentyFourHour.shortDateTime(evening, locale: Locale(identifier: "es_ES"), timeZone: utc) == "21/9/26, 21:13")
  }

  /// Row 41: web's Edited tooltip names the change ("Edited {when}"), not the bare timestamp.
  @Test func editedTooltipSaysEditedBeforeTheTime() {
    let locale = Locale(identifier: "en_US")
    #expect(TimeFormatPreference.twentyFourHour.edited(evening, locale: locale, timeZone: utc) == "Edited Sep 21, 2026 at 21:13")
    #expect(TimeFormatPreference.twelveHour.edited(evening, locale: locale, timeZone: utc) == "Edited Sep 21, 2026 at 9:13\u{202F}PM")
  }

  @Test func autoTitleNamesWhatItResolvesTo() {
    #expect(TimeFormatPreference.detected(locale: Locale(identifier: "en_US")) == .twelveHour)
    #expect(TimeFormatPreference.detected(locale: Locale(identifier: "de_DE")) == .twentyFourHour)
    #expect(TimeFormatPreference.auto.title(locale: Locale(identifier: "de_DE")) == "Auto (24-hour)")
    #expect(TimeFormatPreference.auto.title(locale: Locale(identifier: "en_US")) == "Auto (12-hour)")
    #expect(TimeFormatPreference.twelveHour.title() == "12-hour" && TimeFormatPreference.twentyFourHour.title() == "24-hour")
  }
}

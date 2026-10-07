import Foundation

/// Web's `format.relativeTime(date, { now, style })` (next-intl): the unit is the largest that fits — seconds
/// under a minute, then minutes, hours, days, weeks, months (a twelfth of a year), years — and the value is
/// rounded as JavaScript's `Math.round` does. Seconds may read "now"; other units are always numeric, so a day
/// ago reads "1 day ago", not "yesterday". `.abbreviated` is web's `narrow` ("2m ago", the Thread reply bar),
/// `.full` its default `long` ("2 minutes ago", the Members inspector's read times).
public func relativeAgeLabel(
  since date: Date, now: Date, unitsStyle: RelativeDateTimeFormatter.UnitsStyle, locale: Locale = .current
) -> String {
  let seconds = date.timeIntervalSince(now)
  let day = 86400.0
  let units: [(Calendar.Component, TimeInterval)] = [
    (.second, 1), (.minute, 60), (.hour, 3600), (.day, day), (.weekOfMonth, 7 * day), (.month, 365 * day / 12), (.year, 365 * day)
  ]
  let limits: [TimeInterval] = [60, 3600, day, 7 * day, 365 * day / 12, 365 * day]
  let index = limits.firstIndex { abs(seconds) < $0 } ?? units.count - 1
  let (component, length) = units[index]
  let formatter = RelativeDateTimeFormatter()
  formatter.locale = locale
  formatter.unitsStyle = unitsStyle
  formatter.dateTimeStyle = component == .second ? .named : .numeric
  var components = DateComponents()
  components.setValue(Int((seconds / length + 0.5).rounded(.down)), for: component)
  return formatter.localizedString(from: components)
}

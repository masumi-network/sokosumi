import CoreAPI
import Foundation

/// Slack-style gap before a same-sender burst starts a new full header.
/// Mirrors web `MESSAGE_GROUP_GAP_MS`.
public let messageGroupGapSeconds: TimeInterval = 5 * 60

/// Stable sender identity for grouping; nil when identity is unknown.
/// Mirrors web `messageSenderKey`.
public func messageSenderKey(_ message: Components.Schemas.ChatRoomMessage) -> String? {
  switch message.sender {
  case let .case1(user):
    "user:\(user.user.id)"
  case let .case2(coworker):
    "coworker:\(coworker.coworker.id)"
  case let .case3(bot):
    "sokoBot:\(bot.sokoBot.id)"
  case .case4:
    nil
  }
}

/// True when `current` renders as a continuation of `previous` (no avatar /
/// name / wall-clock; the group header time covers the burst). Mirrors web
/// `isMessageContinuation`: same sender, same calendar day, `0 <= gap < 5m`,
/// never across membership rows.
public func isMessageContinuation(
  previous: Components.Schemas.ChatRoomMessage?,
  current: Components.Schemas.ChatRoomMessage,
  gapSeconds: TimeInterval = messageGroupGapSeconds,
  calendar: Calendar = .current
) -> Bool {
  guard let previous else { return false }
  // Membership status rows are not chat bubbles; never continue across them.
  if previous.membership != nil || current.membership != nil {
    return false
  }
  guard let previousKey = messageSenderKey(previous),
        let currentKey = messageSenderKey(current),
        previousKey == currentKey
  else { return false }
  if !calendar.isDate(previous.createdAt, inSameDayAs: current.createdAt) {
    return false
  }
  let gap = current.createdAt.timeIntervalSince(previous.createdAt)
  if gap < 0 || gap >= gapSeconds {
    return false
  }
  return true
}

/// Day separator label for `date` when it starts a new calendar day in the
/// transcript; nil when it continues `previous`' day. Mirrors web
/// `formatDaySeparator`: Today / Yesterday / weekday / dd/mm/yyyy.
public func daySeparatorLabel(
  for date: Date,
  previous: Date?,
  now: Date = Date(),
  calendar: Calendar = .current
) -> String? {
  if let previous, calendar.isDate(date, inSameDayAs: previous) {
    return nil
  }
  if calendar.isDate(date, inSameDayAs: now) {
    return "Today"
  }
  if let yesterday = calendar.date(byAdding: .day, value: -1, to: now),
     calendar.isDate(date, inSameDayAs: yesterday) {
    return "Yesterday"
  }
  let startOfToday = calendar.startOfDay(for: now)
  let startOfDate = calendar.startOfDay(for: date)
  let daysDiff = calendar.dateComponents([.day], from: startOfDate, to: startOfToday).day ?? 0
  let formatter = DateFormatter()
  formatter.calendar = calendar
  if daysDiff < 7 {
    // Web hardcodes the English weekday array; match it exactly.
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.dateFormat = "EEEE"
  } else {
    formatter.dateFormat = "dd/MM/yyyy"
  }
  return formatter.string(from: date)
}

/// Centered status text for join/leave rows ("{name} joined" / "{name} left").
/// Mirrors web `MembershipStatusRow`. Nil when the message is not a
/// membership row.
public func membershipStatusText(_ message: Components.Schemas.ChatRoomMessage) -> String? {
  guard let membership = message.membership else { return nil }
  let name: String
  switch membership.subject {
  case let .case1(user):
    name = user.name
  case let .case2(coworker):
    name = coworker.name
  default:
    return nil
  }
  switch membership.action {
  case .joined:
    return "\(name) joined"
  case .left:
    return "\(name) left"
  }
}

/// Initials for avatar fallbacks: first letters of the first two words,
/// "?" when there is nothing to take them from.
public func initials(for name: String) -> String {
  let words = name.split(separator: " ")
  let first = words.first?.first.map(String.init) ?? ""
  let second = words.dropFirst().first?.first.map(String.init) ?? ""
  let result = first + second
  return result.isEmpty ? "?" : result
}

import SokosumiChat
import SwiftUI

/// The String Catalog for where an unprompted Soko Bot message came from (`ChatSokoBot.xcstrings`).
let sokoBotSourceTable = "ChatSokoBot"

extension SokoBotSourceLabel {
  /// Web's lucide icons as SF Symbols: Mail, CalendarClock for both system schedules, Clock, ListChecks.
  var systemImage: String {
    switch self {
    case .inbox: "envelope"
    case .standup, .weeklyWrap: "calendar.badge.clock"
    case .scheduled: "clock"
    case .taskUpdate: "checklist"
    }
  }

  /// Web `App.Chat.SokoBot.source`.
  var title: Text {
    switch self {
    case .inbox:
      Text("From your inbox", tableName: sokoBotSourceTable, comment: "Above a message the Soko Bot sent about something that reached the owner's inbox.")
    case .standup:
      Text("Daily stand-up", tableName: sokoBotSourceTable, comment: "Above a message the Soko Bot sent from its daily stand-up schedule.")
    case .weeklyWrap:
      Text("Weekly wrap", tableName: sokoBotSourceTable, comment: "Above a message the Soko Bot sent from its weekly wrap schedule.")
    case let .scheduled(name):
      Text("Scheduled: \(name)", tableName: sokoBotSourceTable,
           comment: "Above a message the Soko Bot sent from another schedule. Argument: the schedule's name.")
    case .taskUpdate:
      Text("Task update", tableName: sokoBotSourceTable, comment: "Above a message the Soko Bot sent because a Task changed.")
    }
  }
}

/// Web `SokoBotSourceLabel` (#5536): a quiet line above a message the bot sent on its own, saying what triggered it (row 38c).
struct SokoBotSourceLabelView: View {
  let label: SokoBotSourceLabel

  var body: some View {
    Label {
      label.title
    } icon: {
      Image(systemName: label.systemImage)
    }
    .font(.caption)
    .foregroundStyle(.secondary)
  }
}

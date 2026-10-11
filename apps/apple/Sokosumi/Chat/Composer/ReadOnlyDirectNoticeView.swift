import Foundation
import SokosumiChat
import SwiftUI

/// The String Catalog for the Read-only Direct notice (`ChatReadOnlyDirect.xcstrings`).
let readOnlyDirectTable = "ChatReadOnlyDirect"

extension ReadOnlyDirectNotice {
  /// Web `App.Channels.readOnlyDirectNotice` / `readOnlyDirectNoticeUnnamed`; the count agrees the verb in German
  /// and Spanish.
  func text(locale: Locale = .current) -> LocalizedStringResource {
    switch self {
    case let .named(members, count):
      LocalizedStringResource(
        "\(members) left. You can still read past messages, but you can't send new ones. \(count)",
        table: readOnlyDirectTable, locale: locale,
        comment: "Stands in for the composer in a Direct everyone else has left."
      )
    case .unnamed:
      LocalizedStringResource(
        "Everyone else left. You can still read past messages, but you can't send new ones.",
        table: readOnlyDirectTable, locale: locale,
        comment: "Stands in for the composer in a Direct everyone else has left, when none of them has a profile left to name."
      )
    }
  }
}

/// Web `ReadOnlyDirectNotice`: stands in for the room and Thread composers of a Read-only Direct. Every other
/// participant has left, so nobody would read a new message; the history stays readable.
struct ReadOnlyDirectNoticeView: View {
  let notice: ReadOnlyDirectNotice
  /// 20 in the room, 16 in the narrower Thread panel.
  var horizontalInset: CGFloat = 16
  @Environment(\.locale) private var locale

  var body: some View {
    // The message text size, muted, where the composer was.
    Text(notice.text(locale: locale))
      .foregroundStyle(.secondary)
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(.horizontal, horizontalInset)
      .padding(.vertical, 12)
      // The transcript scrolls under the inset, as under the composer.
      .background(.background)
  }
}

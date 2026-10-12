import SwiftUI

/// Web's `composerTooLongHint` under both composers, a `role="alert"` line: shown while the draft is over the
/// limit and announced once as it appears, not again on each keystroke while it stays.
struct ComposerTooLongHint: View {
  static let message: LocalizedStringResource = "Too long to send as text"

  /// Posts the announcement; tests pass a recorder, since the test host has no VoiceOver to hear it.
  var announce: (String) -> Void = { AccessibilityNotification.Announcement($0).post() }

  var body: some View {
    Text(Self.message).font(.caption).foregroundStyle(.red)
      // The composers insert the hint only over the limit, so it appears once per trip over it.
      .onAppear { announce(String(localized: Self.message)) }
  }
}

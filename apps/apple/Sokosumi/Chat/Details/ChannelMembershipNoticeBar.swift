import SokosumiChat
import SwiftUI

/// Web's success toast for a members-panel change, docked under the roster (SOK-1258). An undoable notice waits to be
/// closed, like web's `duration: Infinity`; the rest leave after sonner's four seconds.
struct ChannelMembershipNoticeBar: View {
  let notice: ChannelMembershipNotice
  /// Changes with every posted notice, so the same message twice still restarts the timer.
  let serial: Int
  let undoDisabled: Bool
  let undo: (DirectRecipient) -> Void
  let dismiss: () -> Void

  var body: some View {
    HStack(spacing: 8) {
      Image(systemName: "checkmark.circle.fill").foregroundStyle(.green).accessibilityHidden(true)
      Text(notice.message).font(.callout).fixedSize(horizontal: false, vertical: true)
      Spacer(minLength: 0)
      if let member = notice.undo {
        Button("Undo") { undo(member) }
          .controlSize(.small)
          .disabled(undoDisabled)
      }
      Button("Dismiss", systemImage: "xmark", action: dismiss)
        .labelStyle(.iconOnly).buttonStyle(.borderless).help("Dismiss")
    }
    .padding(.horizontal, 12).padding(.vertical, 8)
    .background(.quaternary, in: .rect(cornerRadius: 8))
    .padding([.horizontal, .bottom], 12)
    .accessibilityElement(children: .contain)
    .task(id: serial) {
      AccessibilityNotification.Announcement(notice.message).post()
      guard !notice.staysUntilClosed else { return }
      try? await Task.sleep(for: .seconds(4))
      guard !Task.isCancelled else { return }
      dismiss()
    }
  }
}

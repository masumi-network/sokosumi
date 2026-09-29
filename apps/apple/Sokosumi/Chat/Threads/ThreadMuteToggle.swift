import SwiftUI

/// Row 24b: mute or unmute the open thread from the thread view's toolbar (web `ThreadMuteButton`).
/// The label names the action and the bell shows the state, as web's megaphone does; the toggle stays
/// pressed while the thread is muted and is disabled while Core settles a change.
struct ThreadMuteToggle: View {
  let isMuted: Bool
  let isPending: Bool
  let toggle: () -> Void

  var body: some View {
    let label = isMuted ? "Unmute thread" : "Mute thread"
    Toggle(isOn: Binding(get: { isMuted }, set: { _ in toggle() })) {
      Label(label, systemImage: isMuted ? "bell.slash" : "bell")
    }
    .toggleStyle(.button)
    .labelStyle(.iconOnly)
    .help(label)
    .disabled(isPending)
  }
}

/// A mute or unmute Core refused. Web reverts silently; Apple reverts too and says so here, at the top
/// of the thread, until the next attempt or a dismiss.
struct ThreadMuteFailureRow: View {
  let message: String
  let dismiss: () -> Void

  var body: some View {
    HStack(spacing: 8) {
      Image(systemName: "exclamationmark.triangle.fill")
        .foregroundStyle(.red)
        .accessibilityHidden(true)
      Text(message)
        .font(.callout)
      Spacer(minLength: 8)
      Button("Dismiss", systemImage: "xmark", action: dismiss)
        .labelStyle(.iconOnly)
        .buttonStyle(.borderless)
        .help("Dismiss")
    }
    .padding(.horizontal)
    .padding(.vertical, 8)
    .background(.bar)
    .overlay(alignment: .bottom) { Divider() }
  }
}

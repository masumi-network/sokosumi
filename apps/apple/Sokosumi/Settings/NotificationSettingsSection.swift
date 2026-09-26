import SokosumiChat
import SwiftUI

/// Web Account → Notifications → Chat, as one native Settings section: the
/// group's preset and where each kind arrives. Values come in, so it renders
/// without Core.
struct NotificationSettingsSection: View {
  let kinds: [ChatNotificationKind]
  let preset: ChatNotificationPreset?
  let reach: (ChatNotificationKind) -> ChatNotificationReach
  let isSaving: Bool
  let isAvailable: Bool
  let bannersBlocked: Bool
  let error: String?
  let onPreset: (ChatNotificationPreset) -> Void
  let onReach: (ChatNotificationKind, ChatNotificationReach) -> Void

  var body: some View {
    Section {
      // A group Core answered only part of has no preset to offer (web hides the rail).
      if kinds.count == ChatNotificationKind.allCases.count {
        Picker(selection: presetSelection) {
          ForEach(ChatNotificationPreset.allCases) { preset in
            Text(preset.title).tag(PresetChoice.preset(preset))
          }
          if preset == nil {
            Text("Custom").tag(PresetChoice.custom)
          }
        } label: {
          Text("Chat notifications")
          Text(preset?.hint ?? "Each kind is set on its own below.")
        }
      }
      ForEach(kinds) { kind in
        Picker(selection: Binding(get: { reach(kind) }, set: { onReach(kind, $0) })) {
          ForEach(ChatNotificationReach.allCases) { reach in
            Text(reach.title).tag(reach)
          }
        } label: {
          Text(kind.title)
          Text(kind.hint)
        }
      }
      if bannersBlocked {
        LabeledContent {
          if let url = URL(string: "x-apple.systempreferences:com.apple.Notifications-Settings.extension") {
            Link("Open System Settings", destination: url)
          }
        } label: {
          Text("Banners are turned off for Sokosumi")
          Text("Allow notifications for Sokosumi in System Settings to see banners on this Mac.")
        }
      }
      if let error {
        Text(error).foregroundStyle(.red)
      }
    } header: {
      Text("Notifications")
    } footer: {
      Text("Banners appear on this Mac while Sokosumi is running in the background. These choices belong to your account and also apply to Sokosumi on the web.")
    }
    .disabled(isSaving || !isAvailable)
  }

  private enum PresetChoice: Hashable {
    case preset(ChatNotificationPreset)
    case custom
  }

  private var presetSelection: Binding<PresetChoice> {
    Binding {
      preset.map(PresetChoice.preset) ?? .custom
    } set: { choice in
      if case let .preset(preset) = choice {
        onPreset(preset)
      }
    }
  }
}

private extension ChatNotificationPreset {
  var title: String {
    switch self {
    case .most: "Most"
    case .essential: "Essential"
    case .appOnly: "In app"
    case .off: "Off"
    }
  }

  var hint: String {
    switch self {
    case .most: "Every message in your rooms arrives in the app. Mentions and direct messages arrive as a banner as well."
    case .essential: "Mentions and direct messages arrive as a banner. Every message in your rooms is off."
    case .appOnly: "Mentions and direct messages arrive in the app. Every message in your rooms is off, and nothing arrives as a banner."
    case .off: "No chat notification arrives, in the app or as a banner."
    }
  }
}

private extension ChatNotificationKind {
  var title: String {
    switch self {
    case .roomMessage: "Every message in your rooms"
    case .mention: "Mentions"
    case .directMessage: "Direct messages"
    }
  }

  var hint: String {
    switch self {
    case .roomMessage: "Anyone posts in a room you are in. Off unless you turn it on."
    case .mention: "Someone writes your name in a message, or mentions everyone in a room."
    case .directMessage: "Someone messages you one to one."
    }
  }
}

private extension ChatNotificationReach {
  var title: String {
    switch self {
    case .off: "Off"
    case .inApp: "In app"
    case .banner: "In app and banner"
    }
  }
}

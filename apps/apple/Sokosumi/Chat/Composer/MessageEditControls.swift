#if os(macOS)
  import SwiftUI

  /// Compact Cancel and Save at the trailing edge of the edit field, centred on its first line, like editing
  /// a message in Messages. They are the pointer and Switch Control path beside Return and Escape; web draws
  /// Cancel and Save text buttons under the field instead (row 18b, a recorded deviation). Save is enabled
  /// only for a changed, non-empty draft within the limit, as web's (row 18c).
  struct MessageEditControls: View {
    @Environment(\.isEnabled) private var isEnabled
    let canSave: Bool
    let save: () -> Void
    let cancel: () -> Void

    var body: some View {
      HStack(spacing: 6) {
        Button("Cancel", systemImage: "xmark.circle.fill", action: cancel)
          .foregroundStyle(.secondary)
          .help("Cancel (Escape)")
          .accessibilityLabel("Cancel")
        // An explicit foreground style does not dim with `.disabled`, so the disabled Save turns tertiary.
        // While a save is in flight the composer is disabled and dims both controls itself.
        Button("Save", systemImage: "checkmark.circle.fill", action: save)
          .foregroundStyle(canSave || !isEnabled ? AnyShapeStyle(.tint) : AnyShapeStyle(.tertiary))
          .disabled(!canSave)
          .help("Save (Return)")
          .accessibilityLabel("Save")
      }
      .labelStyle(.iconOnly)
      .buttonStyle(.borderless)
      .imageScale(.large)
      .frame(height: MacComposerTextInput.firstLineHeight)
    }
  }
#endif

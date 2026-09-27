#if os(macOS)
  import SwiftUI

  /// Compact Cancel and Save at the trailing edge of the edit field, centred on its first line, like editing
  /// a message in Messages. They are the pointer and Switch Control path beside Return and Escape; web has
  /// only the keys (row 18b, a recorded deviation).
  struct MessageEditControls: View {
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
        Button("Save", systemImage: "checkmark.circle.fill", action: save)
          .foregroundStyle(canSave ? AnyShapeStyle(.tint) : AnyShapeStyle(.tertiary))
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

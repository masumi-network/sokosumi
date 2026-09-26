import Foundation

/// A plain-text paste the composer may still swap for something else, and the
/// editor's own undo of it.
struct ComposerTextPaste {
  let text: String
  /// Removes the pasted text, keeping the caret and the words around it.
  /// False when the sender already edited it away.
  let remove: @MainActor () -> Bool
}

/// A one-shot insertion at the caret, applied when its id changes.
struct ComposerInsertion: Equatable {
  let id = UUID()
  let text: String
}

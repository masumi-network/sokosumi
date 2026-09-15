import SwiftUI

#if os(macOS)
  /// Own focus inside the toolbar's view hierarchy.
  struct RoomSearchField: View {
    @Binding var query: String
    let isJumping: Bool
    let submit: () -> Void
    let move: (Int) -> Void
    let close: () -> Void
    @FocusState private var isFocused: Bool

    var body: some View {
      TextField("Search messages", text: $query)
        .textFieldStyle(.roundedBorder)
        .frame(minWidth: 140, idealWidth: 220, maxWidth: 280)
        .focused($isFocused)
        .task { isFocused = true }
        .disabled(isJumping)
        .onSubmit(submit)
        .onKeyPress(.downArrow) {
          move(1)
          return .handled
        }
        .onKeyPress(.upArrow) {
          move(-1)
          return .handled
        }
        .onExitCommand {
          if query.isEmpty {
            close()
          } else {
            query = ""
          }
        }
    }
  }
#endif

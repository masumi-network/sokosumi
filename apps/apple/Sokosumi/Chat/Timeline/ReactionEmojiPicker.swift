import SokosumiChat
import SwiftUI

#if os(macOS)
  struct ReactionEmojiPicker: View {
    let choose: (String) -> Void
    @State private var query = ""
    @FocusState private var searchFocused: Bool

    var body: some View {
      VStack(spacing: 12) {
        TextField("Search emoji", text: $query)
          .textFieldStyle(.roundedBorder)
          .focused($searchFocused)
          .accessibilityLabel("Search emoji")
        let matches = ReactionEmoji.matching(query)
        if matches.isEmpty {
          ContentUnavailableView.search(text: query)
        } else {
          ScrollView {
            LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: 8), spacing: 6) {
              ForEach(matches) { entry in
                Button { choose(entry.emoji) } label: {
                  Text(entry.emoji)
                    .font(.title2)
                    .frame(maxWidth: .infinity, minHeight: 32)
                    .contentShape(.rect)
                }
                .buttonStyle(.borderless)
                .help(entry.label)
                .accessibilityLabel(entry.label)
              }
            }
          }
        }
      }
      .padding()
      .frame(width: 340, height: 300)
      .task { searchFocused = true }
    }
  }
#endif

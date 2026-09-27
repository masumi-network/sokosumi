import SokosumiChat
import SwiftUI

#if os(macOS)
  struct ReactionEmojiPicker: View {
    let choose: (String) -> Void
    @State private var query = ""
    @State private var selectedCategory: ReactionEmoji.Category?
    @State private var frequent: [ReactionEmoji] = []
    @State private var hoveredEmoji: ReactionEmoji?
    @FocusState private var searchFocused: Bool

    private let columns = Array(repeating: GridItem(.flexible(), spacing: 4), count: 8)
    private let suggested = ["👍", "❤️", "😂", "🎉", "👀", "🙌", "✅", "🙏"]

    var body: some View {
      VStack(spacing: 0) {
        HStack(spacing: 2) {
          categoryButton(nil, title: "Search all emoji", symbol: "magnifyingglass")
          ForEach(ReactionEmoji.Category.allCases, id: \.self) { category in
            categoryButton(category, title: category.title, symbol: category.symbol)
          }
        }
        .padding(8)
        Divider()
        TextField("Search all emoji", text: $query)
          .textFieldStyle(.roundedBorder)
          .focused($searchFocused)
          .accessibilityLabel("Search all emoji")
          .padding(12)
        ScrollView {
          LazyVStack(alignment: .leading, spacing: 16) {
            if !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
              let matches = ReactionEmoji.matching(query)
              if matches.isEmpty {
                ContentUnavailableView.search(text: query)
              } else {
                emojiSection("Search results", entries: matches)
              }
            } else if let selectedCategory {
              emojiSection(selectedCategory.title, entries: ReactionEmoji.catalog.filter { $0.category == selectedCategory })
            } else {
              emojiSection(frequent.isEmpty ? "Suggested" : "Frequently Used", entries: frequent.isEmpty ? suggested.compactMap { emoji in ReactionEmoji.catalog.first { $0.emoji == emoji } } : frequent)
              ForEach(ReactionEmoji.Category.allCases, id: \.self) { category in
                emojiSection(category.title, entries: ReactionEmoji.catalog.filter { $0.category == category })
              }
            }
          }
          .padding(.horizontal, 12)
          .padding(.bottom, 12)
        }
        .id(selectedCategory)
        Divider()
        HStack(spacing: 8) {
          if let hoveredEmoji {
            Text(hoveredEmoji.emoji).font(.title2)
            Text(":\(hoveredEmoji.name):").lineLimit(1)
          } else {
            Text("Choose an emoji")
          }
          Spacer(minLength: 0)
        }
        .font(.callout)
        .foregroundStyle(.secondary)
        .padding(.horizontal, 12)
        .frame(height: 42)
      }
      .frame(width: 360, height: 440)
      .onChange(of: query) { _, value in
        if !value.isEmpty {
          selectedCategory = nil
        }
      }
      .task {
        frequent = ReactionEmojiHistory().frequent
        searchFocused = true
      }
    }

    private func categoryButton(_ category: ReactionEmoji.Category?, title: String, symbol: String) -> some View {
      Button {
        selectedCategory = category
        query = ""
        hoveredEmoji = nil
        searchFocused = category == nil
      } label: {
        Image(systemName: symbol)
          .font(.title3)
          .schemeStableSymbolGlyph(.primary)
          .frame(maxWidth: .infinity)
          .frame(height: 30)
          .background(selectedCategory == category ? Color.accentColor.opacity(0.16) : .clear, in: .rect(cornerRadius: 6))
          .contentShape(.rect)
      }
      .buttonStyle(.plain)
      .help(title)
      .accessibilityLabel(title)
      .accessibilityAddTraits(selectedCategory == category ? .isSelected : [])
    }

    private func emojiSection(_ title: String, entries: [ReactionEmoji]) -> some View {
      VStack(alignment: .leading, spacing: 8) {
        Text(title).font(.headline).foregroundStyle(.secondary)
        LazyVGrid(columns: columns, spacing: 4) {
          ForEach(entries) { entry in
            Button { choose(entry.emoji) } label: {
              Text(entry.emoji)
                .font(.title)
                .frame(maxWidth: .infinity, minHeight: 36)
                .background(hoveredEmoji?.id == entry.id ? Color.primary.opacity(0.1) : .clear, in: .rect(cornerRadius: 6))
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .help(entry.label)
            .accessibilityLabel(entry.label)
            .onHover { hoveredEmoji = $0 ? entry : nil }
          }
        }
      }
    }
  }

  private extension ReactionEmoji.Category {
    var title: String {
      switch self {
      case .people: "Smileys & People"
      case .animalsAndNature: "Animals & Nature"
      case .foodAndDrink: "Food & Drink"
      case .activity: "Activities"
      case .travelAndPlaces: "Travel & Places"
      case .objects: "Objects"
      case .symbols: "Symbols"
      case .flags: "Flags"
      }
    }

    var symbol: String {
      switch self {
      case .people: "face.smiling"
      case .animalsAndNature: "leaf"
      case .foodAndDrink: "fork.knife"
      case .activity: "sportscourt"
      case .travelAndPlaces: "airplane"
      case .objects: "lightbulb"
      case .symbols: "heart"
      case .flags: "flag"
      }
    }
  }
#endif

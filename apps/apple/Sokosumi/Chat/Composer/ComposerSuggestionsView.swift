import SokosumiChat
import SwiftUI

/// Portable presentation; the text adapter owns insertion and keyboard events.
struct ComposerSuggestionsView: View {
  let channels: [ComposerChannel]
  let acceptChannel: (ComposerChannel) -> Void
  let mentions: [ComposerMention]
  let emojis: [String]
  let acceptEmoji: (String) -> Void
  @Binding var selectedID: String?
  let accept: (ComposerMention) -> Void

  var body: some View {
    ScrollViewReader { proxy in
      ScrollView {
        LazyVStack(alignment: .leading, spacing: 2) {
          channelRows
          emojiRows
          section("People", entries: mentions.filter { $0.kind == .human || $0.kind == .all })
          section("Agents", entries: mentions.filter { $0.kind == .coworker || $0.kind == .sokoBot })
        }
        .padding(6)
      }
      .frame(height: panelHeight)
      .onChange(of: selectedID) { _, id in
        if let id {
          proxy.scrollTo(id)
        }
      }
    }
    .frame(maxWidth: 440)
    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
    .overlay { RoundedRectangle(cornerRadius: 12).strokeBorder(.separator, lineWidth: 1) }
    .shadow(color: .black.opacity(0.12), radius: 8, y: 3)
    .accessibilityLabel(!channels.isEmpty ? "Channel suggestions" : emojis.isEmpty ? "Mention suggestions" : "Emoji suggestions")
    .offset(y: -panelHeight - 8)
  }

  private var channelRows: some View {
    ForEach(channels) { channel in
      Button { acceptChannel(channel) } label: {
        HStack(spacing: 10) {
          Image(systemName: "number").frame(width: 26, height: 26)
          VStack(alignment: .leading, spacing: 2) {
            Text(channel.name).font(.body)
            Text(channel.organizationName.map { "#\(channel.slug) · \($0)" } ?? "#\(channel.slug)")
              .font(.caption).foregroundStyle(.secondary)
          }.lineLimit(1)
          Spacer(minLength: 0)
        }
        .padding(.horizontal, 10).frame(height: 38)
        .contentShape(Rectangle())
        .background(selectedID == channel.id ? Color.primary.opacity(0.09) : .clear, in: RoundedRectangle(cornerRadius: 6))
      }
      .buttonStyle(.plain)
      .onHover {
        if $0 {
          selectedID = channel.id
        }
      }
      .accessibilityAddTraits(selectedID == channel.id ? .isSelected : [])
      .id(channel.id)
    }
  }

  private var emojiRows: some View {
    ForEach(emojis, id: \.self) { shortcode in
      Button { acceptEmoji(shortcode) } label: {
        HStack(spacing: 10) {
          Text(String(ComposerEmoji.completionPreview(for: shortcode).split(separator: " ").first ?? ""))
            .font(.title2).frame(width: 26, height: 26)
          Text(shortcode).font(.body).lineLimit(1)
          Spacer(minLength: 0)
        }
        .padding(.horizontal, 10).frame(height: 38)
        .contentShape(Rectangle())
        .background(selectedID == shortcode ? Color.primary.opacity(0.09) : .clear, in: RoundedRectangle(cornerRadius: 6))
      }
      .buttonStyle(.plain)
      .onHover {
        if $0 {
          selectedID = shortcode
        }
      }
      .accessibilityLabel(ComposerEmoji.completionPreview(for: shortcode))
      .accessibilityAddTraits(selectedID == shortcode ? .isSelected : [])
      .id(shortcode)
    }
  }

  private var panelHeight: CGFloat {
    min(CGFloat((mentions.count + emojis.count + channels.count) * 40 + sectionCount * 28 + 12), 300)
  }

  private var sectionCount: Int {
    Set(mentions.map { $0.kind == .human || $0.kind == .all }).count
  }

  @ViewBuilder private func section(_ title: String, entries: [ComposerMention]) -> some View {
    if !entries.isEmpty {
      Text(title)
        .font(.caption).foregroundStyle(.secondary)
        .padding(.horizontal, 10).frame(height: 26)
      ForEach(entries) { mention in
        Button { accept(mention) } label: {
          HStack(spacing: 10) {
            if mention.kind == .all {
              Image(systemName: "person.2")
                .frame(width: 26, height: 26)
                .background(.quaternary, in: Circle())
            } else {
              ParticipantAvatar(imageURL: mention.image, name: mention.name, size: 26)
            }
            VStack(alignment: .leading, spacing: 2) {
              Text(mention.name).font(.body).foregroundStyle(.primary)
              Text("@" + mention.slug).font(.caption).foregroundStyle(.secondary)
            }
            .lineLimit(1)
            Spacer(minLength: 0)
          }
          .padding(.horizontal, 10)
          .frame(height: 38)
          .contentShape(Rectangle())
          .background(selectedID == mention.id ? Color.primary.opacity(0.09) : .clear, in: RoundedRectangle(cornerRadius: 6))
        }
        .buttonStyle(.plain)
        .onHover {
          if $0 {
            selectedID = mention.id
          }
        }
        .accessibilityLabel("\(mention.name), @\(mention.slug)")
        .accessibilityAddTraits(selectedID == mention.id ? .isSelected : [])
        .id(mention.id)
      }
    }
  }
}

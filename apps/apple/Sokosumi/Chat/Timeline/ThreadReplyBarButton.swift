import SokosumiChat
import SwiftUI

/// Row 24h: web's `ThreadReplyBar` under a thread parent in the room transcript. The repliers' faces, the
/// count ("3 replies", or "2 new replies" while this reader has unread ones) and the last reply's age, which
/// ticks every minute. Unread reads as a bar: the accent tint with a rule down its leading edge. It stays a
/// native button — hover, the link pointer and keyboard focus — whose name is the count alone; the age is
/// its hint and the faces are decoration.
struct ThreadReplyBarButton: View {
  let bar: ThreadReplyBar
  let open: () -> Void
  @State private var isHovered = false
  @Environment(\.locale) private var locale

  /// Web's `size-4` faces overlapping by `-space-x-1`.
  static let faceDiameter: CGFloat = 16

  var body: some View {
    // Web's `useNow({ updateInterval: 60_000 })`: now, then every minute. `.everyMinute` would read the start
    // of the minute and understate the age by up to a minute.
    TimelineView(.periodic(from: .now, by: 60)) { context in
      let age = bar.lastReplyAt.map { threadReplyAgeLabel(since: $0, now: context.date, locale: locale) }
      let button = Button(action: open) {
        label(age: age)
      }
      .buttonStyle(.plain)
      .pointerStyle(.link)
      .onHover { isHovered = $0 }
      .accessibilityLabel(bar.label)
      // Web's `aria-describedby` exists only with an age; without one there is no hint at all.
      if let age {
        button.accessibilityHint(age)
      } else {
        button
      }
    }
  }

  private func label(age: String?) -> some View {
    HStack(spacing: 6) {
      if !bar.faces.isEmpty {
        faces
      }
      Text(bar.label)
        .fontWeight(bar.isUnread ? .semibold : .medium)
        .foregroundStyle(.tint)
      if let age {
        Text(verbatim: "·").foregroundStyle(.secondary)
        Text(age).foregroundStyle(.secondary).monospacedDigit()
      }
    }
    .font(.caption)
    .lineLimit(1)
    // Web's `text-xs` line is as tall as a face, so a bar with faces is no taller than one without.
    .frame(minHeight: Self.faceDiameter)
    .padding(.horizontal, bar.isUnread ? 10 : 0)
    .padding(.vertical, bar.isUnread ? 4 : 0)
    .background { background }
    .contentShape(.rect)
  }

  /// Who replied, the first on top; a hairline in the window colour keeps the overlapping faces apart.
  private var faces: some View {
    HStack(spacing: -4) {
      ForEach(Array(bar.faces.enumerated()), id: \.element.id) { index, face in
        ParticipantAvatar(imageURL: face.imageURL, name: face.name, size: Self.faceDiameter, monogram: true)
          .background(Circle().fill(.background).padding(-1))
          .zIndex(Double(bar.faces.count - index))
      }
    }
    .accessibilityHidden(true)
  }

  @ViewBuilder
  private var background: some View {
    if bar.isUnread {
      ZStack(alignment: .leading) {
        Rectangle().fill(Color.accentColor.opacity(isHovered ? 0.22 : 0.15))
        Rectangle().fill(.tint).frame(width: 2)
      }
      .clipShape(.rect(cornerRadius: 8))
    } else if isHovered {
      // Web only deepens the text; a Mac control also answers the pointer with a highlight behind it.
      RoundedRectangle(cornerRadius: 6)
        .fill(Color.accentColor.opacity(0.08))
        .padding(.horizontal, -4)
        .padding(.vertical, -2)
    }
  }
}

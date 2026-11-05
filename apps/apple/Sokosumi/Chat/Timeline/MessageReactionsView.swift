import CoreAPI
import SokosumiChat
import SwiftUI

#if os(macOS)
  struct MessageReactionsView: View {
    let reactions: [Components.Schemas.ChatRoomMessageReaction]
    var toggle: ((String) -> Void)?
    @Environment(\.transcriptScrollActivity) private var scrollActivity
    @State private var hoveredEmoji: String?
    @FocusState private var focusedEmoji: String?
    @Namespace private var row

    /// The chip under the pointer, unless the transcript is carrying it there (M8). Scroll activity is read only while a
    /// chip is hovered or focused, so a scroll starting or ending re-evaluates that row alone (M6).
    private var hoveredShown: String? {
      settled(hoveredEmoji)
    }

    /// The chip whose label shows: the one under the pointer, else the one holding keyboard focus, as web's Radix
    /// tooltip also opens on focus. Web opens one tooltip at a time, so a focused chip gives way to a chip hovered in
    /// another row; the transcript is read only while this row holds focus and no pointer.
    private var labelledEmoji: String? {
      if let hoveredEmoji {
        return settled(hoveredEmoji)
      }
      guard let focusedEmoji, scrollActivity?.reactionRowUnderPointer == nil else { return nil }
      return settled(focusedEmoji)
    }

    private func settled(_ emoji: String?) -> String? {
      emoji.flatMap { scrollActivity?.isScrolling == true ? nil : $0 }
    }

    var body: some View {
      WrappingRow(spacing: 6) {
        ForEach(reactions, id: \.emoji) { reaction in
          let hovered = hoveredShown == reaction.emoji
          let labelled = labelledEmoji == reaction.emoji
          Group {
            if let toggle {
              Button { toggle(reaction.emoji) } label: { chip(reaction, hovered: hovered) }
                .buttonStyle(.plain)
            } else {
              // Web's `aria-disabled` chip: drawn as usual and still says who reacted, but takes no tap (a
              // Read-only Direct, or a message that cannot take Reactions yet).
              chip(reaction, hovered: false)
                .accessibilityElement(children: .ignore)
                // Web's chip stays a focusable `<button>`; like a button, reached only with keyboard navigation on.
                .focusable(interactions: .activate)
            }
          }
          .focused($focusedEmoji, equals: reaction.emoji)
          // M10: web's chip tooltip shows at once (`delayDuration = 0`); the native `.help` waited a second or more.
          // The chip only says where; `whoReactedLabel()` on the row draws it, above the row's hover pill.
          .anchorPreference(key: WhoReactedLabelKey.self, value: .bounds) { bounds in
            labelled ? reaction.whoReacted.map { WhoReactedLabelValue(text: $0, chip: bounds) } : nil
          }
          .onHover { inside in
            if inside {
              hoveredEmoji = reaction.emoji
              if scrollActivity?.reactionRowUnderPointer != row {
                scrollActivity?.reactionRowUnderPointer = row
              }
            } else if hoveredEmoji == reaction.emoji {
              hoveredEmoji = nil
              releasePointer()
            }
          }
          .accessibilityLabel("\(reaction.emoji), ^[\(reaction.count) reaction](inflect: true)")
          .accessibilityValue(reaction.reactedByCurrentUser ? "You reacted" : "You have not reacted")
          .accessibilityHint(reaction.whoReacted ?? "")
        }
      }
      .onDisappear(perform: releasePointer)
    }

    private func releasePointer() {
      if scrollActivity?.reactionRowUnderPointer == row {
        scrollActivity?.reactionRowUnderPointer = nil
      }
    }

    /// Web's chip: `hover:bg-muted` only on a chip that takes a tap.
    private func chip(_ reaction: Components.Schemas.ChatRoomMessageReaction, hovered: Bool) -> some View {
      HStack(spacing: 4) {
        Text(reaction.emoji)
        Text(reaction.count, format: .number).font(.caption)
      }
      .padding(.horizontal, 8)
      .padding(.vertical, 4)
      .background(reaction.reactedByCurrentUser ? Color.primary.opacity(hovered ? 0.2 : 0.14) : Color.secondary.opacity(hovered ? 0.22 : 0.12),
                  in: .capsule)
      .overlay(Capsule().strokeBorder(reaction.reactedByCurrentUser ? Color.primary.opacity(0.5) : Color.secondary.opacity(0.3)))
      .contentShape(.capsule)
    }
  }

  private struct WhoReactedLabelValue: Equatable {
    let text: String
    let chip: Anchor<CGRect>
  }

  private struct WhoReactedLabelKey: PreferenceKey {
    static let defaultValue: WhoReactedLabelValue? = nil

    static func reduce(value: inout WhoReactedLabelValue?, nextValue: () -> WhoReactedLabelValue?) {
      value = value ?? nextValue()
    }
  }

  extension View {
    /// Draws the hovered or focused reaction chip's who-reacted label over this view. Put it after the row's hover pill, so
    /// the label sits on top of the pill as web's portalled tooltip does.
    func whoReactedLabel() -> some View {
      overlayPreferenceValue(WhoReactedLabelKey.self) { value in
        if let value {
          GeometryReader { proxy in
            let chip = proxy[value.chip]
            // A zero-height anchor on the chip's top edge; the label hangs from it by its bottom.
            Color.clear.frame(width: chip.width, height: 0)
              .overlay(alignment: .bottomLeading) { WhoReactedLabel(text: value.text) }
              .offset(x: chip.minX, y: chip.minY)
          }
        }
      }
    }
  }

  /// Who reacted, above the chip's leading edge (web's `TooltipContent side="top" sideOffset={6}`). Leading rather than
  /// centred, so a chip at the transcript's leading edge keeps its label inside the scroll view. VoiceOver reads the
  /// same names from the chip's hint.
  private struct WhoReactedLabel: View {
    let text: String

    var body: some View {
      CappedWidth(maxWidth: 280) {
        Text(text).font(.caption)
      }
      .padding(.horizontal, 8)
      .padding(.vertical, 4)
      .background(.regularMaterial, in: .rect(cornerRadius: 6))
      .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(.primary.opacity(0.12)))
      .shadow(color: .black.opacity(0.12), radius: 3, y: 1)
      .padding(.bottom, 6)
      .allowsHitTesting(false)
      .accessibilityHidden(true)
    }
  }

  /// One line up to `maxWidth`, wrapping past it: the overlay proposes only the chip's width, and Core lists up to
  /// 20 names.
  private struct CappedWidth: Layout {
    let maxWidth: CGFloat

    func sizeThatFits(proposal _: ProposedViewSize, subviews: Subviews, cache _: inout Void) -> CGSize {
      guard let content = subviews.first else { return .zero }
      let width = min(content.sizeThatFits(.unspecified).width, maxWidth)
      return content.sizeThatFits(ProposedViewSize(width: width, height: nil))
    }

    func placeSubviews(in bounds: CGRect, proposal _: ProposedViewSize, subviews: Subviews, cache _: inout Void) {
      subviews.first?.place(at: bounds.origin, proposal: ProposedViewSize(bounds.size))
    }
  }
#endif

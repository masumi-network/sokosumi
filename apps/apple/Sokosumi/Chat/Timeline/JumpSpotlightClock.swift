#if os(macOS)
  import SokosumiChat
  import SwiftUI

  /// One clock per message list for the jump spotlight (row 25b2): while the list holds a mark, every other
  /// message row in it steps back (web's `chat-jump-dim` and `chat-jump-undim` in globals.css). The list's one
  /// timeline ticks it once a frame for as long as the mark holds; each row reads it in a modifier of its own, so a
  /// changed value re-evaluates those modifiers and never a row's body. `show` writes only a changed value, so
  /// while the value holds, as through the full-strength stretch, no row's modifier is invalidated.
  @MainActor @Observable final class JumpSpotlightClock {
    /// The mark the list holds. Its row stays out of the spotlight.
    fileprivate(set) var mark: JumpMark?
    /// Where every other row stands.
    fileprivate(set) var spotlight = JumpSpotlight.none

    fileprivate func show(_ next: JumpSpotlight, for mark: JumpMark?) {
      if self.mark != mark {
        self.mark = mark
      }
      if spotlight != next {
        spotlight = next
      }
    }

    /// Where the row holding `messageId` stands.
    fileprivate func spotlight(of messageId: String) -> JumpSpotlight {
      mark?.messageId == messageId ? .none : spotlight
    }
  }

  extension View {
    /// Casts the spotlight of the list's `mark` over its rows. Put on the list once, around every row.
    func jumpSpotlight(for mark: JumpMark?) -> some View {
      modifier(JumpSpotlightList(mark: mark))
    }

    /// A message row that steps back while its list holds a mark on another row. Day separators, page boundaries
    /// and other list chrome stay as they are, as web dims only `[data-message-id]` rows.
    func jumpSpotlightRow(messageId: String) -> some View {
      modifier(JumpSpotlightRow(messageId: messageId))
    }
  }

  private struct JumpSpotlightList: ViewModifier {
    let mark: JumpMark?
    @State private var clock = JumpSpotlightClock()
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.jumpMarkClock) private var jumpMarkClock

    func body(content: Content) -> some View {
      content
        .environment(clock)
        .background {
          // Reduce Motion casts no spotlight (web's `prefers-reduced-motion` block), so nothing ticks.
          if let mark, !reduceMotion {
            TimelineView(.animation) { context in
              Color.clear.onChange(of: context.date, initial: true) {
                clock.show(JumpSpotlight(stage: mark.stage(at: jumpMarkClock.now), dark: colorScheme == .dark, reduceMotion: false,
                                         easing: UnitCurve.easeOut.value(at:)), for: mark)
              }
            }
          }
        }
        // A mark that ends, or is cut by a reader scroll at either end of its hold, takes the spotlight with it.
        .onChange(of: reduceMotion ? nil : mark, initial: true) { _, mark in
          if mark == nil {
            clock.show(.none, for: nil)
          }
        }
    }
  }

  private struct JumpSpotlightRow: ViewModifier {
    let messageId: String
    @Environment(JumpSpotlightClock.self) private var clock: JumpSpotlightClock?

    func body(content: Content) -> some View {
      let spotlight = clock?.spotlight(of: messageId) ?? .none
      content
        .opacity(spotlight.opacity)
        .blur(radius: spotlight.blurRadius)
    }
  }
#endif

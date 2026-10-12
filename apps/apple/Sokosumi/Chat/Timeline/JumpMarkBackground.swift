#if os(macOS)
  import AppKit
  import SokosumiChat
  import SwiftUI

  /// The mark a jump leaves on the row it landed on, drawn off `JumpMark`'s clock (web's `--chat-jump-*` block in
  /// globals.css): a wash of the accent under the whole row that opens from the centre, and a 3 pt rail at the
  /// row's leading edge that grows from its middle. Both fade together. Reduce Motion holds the mark steady and
  /// drops it at once, as web's `prefers-reduced-motion` block does.
  struct JumpMarkBackground: View {
    let mark: JumpMark
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.jumpMarkClock) private var clock

    var body: some View {
      // The timeline only ticks; the mark's own clock says where it is.
      TimelineView(.animation(paused: reduceMotion)) { _ in
        let drawing = Self.drawing(mark.stage(at: clock.now), reduceMotion: reduceMotion)
        ZStack(alignment: .leading) {
          wash.scaleEffect(x: 0.55 + 0.45 * drawing.open, y: 1)
          RoundedRectangle(cornerRadius: 3)
            .fill(Color.accentColor)
            .frame(width: 3)
            .scaleEffect(x: 1, y: 0.15 + 0.85 * drawing.open)
            .padding(.vertical, 3)
        }
        .opacity(drawing.strength)
      }
      .allowsHitTesting(false)
      .accessibilityHidden(true)
    }

    /// Web mixes the primary into the row at 16 / 11 / 10 % across it, and runs dark stronger (26 / 20 / 18 %):
    /// a light accent over a dark ground lifts far less than a saturated one over white.
    private var wash: some View {
      let dark = colorScheme == .dark
      return LinearGradient(stops: [
        .init(color: .accentColor.opacity(dark ? 0.26 : 0.16), location: 0),
        .init(color: .accentColor.opacity(dark ? 0.2 : 0.11), location: 0.45),
        .init(color: .accentColor.opacity(dark ? 0.18 : 0.1), location: 1)
      ], startPoint: .leading, endPoint: .trailing)
    }

    /// How strongly the mark draws, and how far the wash and rail have opened, each 0 to 1. Web's keyframes run
    /// `ease-out` between their stops.
    private static func drawing(_ stage: JumpMark.Stage, reduceMotion: Bool) -> (strength: Double, open: Double) {
      switch stage {
      case let .opening(progress):
        reduceMotion ? (1, 1) : (UnitCurve.easeOut.value(at: progress), UnitCurve.easeOut.value(at: progress))
      case .full:
        (1, 1)
      case let .closing(progress):
        (reduceMotion ? 1 : 1 - UnitCurve.easeOut.value(at: progress), 1)
      case let .leaving(progress):
        (reduceMotion ? 0 : 1 - UnitCurve.easeOut.value(at: progress), 1)
      case .ended:
        (0, 1)
      }
    }
  }

  extension ScrollPhase {
    /// Whether this phase is the reader scrolling the list, which ends a jump mark. Web listens for `wheel` and
    /// `touchmove` only (`READER_SCROLL_EVENTS` in room-message-highlight.ts), so dragging or clicking the
    /// scroller, and scrolling by keyboard, leave the mark standing. SwiftUI reports a scroller drag as
    /// `.interacting` just as it does a wheel or trackpad scroll, but the drag's is reported while the press that
    /// started it is the app's current event. A key behind the phase is keyboard scrolling, which web leaves be too.
    @MainActor var endsJumpMark: Bool {
      guard self == .interacting else { return false }
      switch NSApp.currentEvent?.type {
      case .leftMouseDown, .leftMouseDragged, .leftMouseUp, .keyDown, .keyUp: return false
      default: return true
      }
    }
  }
#endif

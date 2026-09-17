import CoreAPI
import SwiftUI

/// Web `PresenceDot`: availability as one silhouette per state — a filled
/// disc (online), a crescent (away) and a hollow ring (offline) — so the
/// three stay apart without colour. The mark is decorative; every surface
/// states availability in its own text or accessibility value.
struct PresenceDot: View {
  let presence: Components.Schemas.ChatRoomPresence
  /// Outer diameter. One point of it is the halo painted in the ground
  /// colour so the mark reads on top of an avatar (web `size-2.5` = 10).
  var size: CGFloat = 10

  private var core: CGFloat {
    size - 2
  }

  var body: some View {
    ZStack {
      Circle().fill(.background)
      mark.frame(width: core, height: core)
    }
    .frame(width: size, height: size)
    .accessibilityHidden(true)
  }

  @ViewBuilder
  private var mark: some View {
    switch presence {
    case .online:
      Circle().fill(.green)
    case .afk:
      // The crescent is the disc minus an offset copy of itself, painted in
      // the ground so the bite reads as a bite and not as a dot on a disc.
      Circle().fill(.orange)
        .overlay {
          Circle().fill(.background)
            .scaleEffect(0.72)
            .offset(x: core * 0.32, y: -core * 0.32)
        }
        .clipShape(Circle())
    case .offline:
      Circle().strokeBorder(.secondary, lineWidth: 1)
    }
  }
}

/// Labels for the three states; web `App.Channels.Presence`.
func presenceLabel(_ presence: Components.Schemas.ChatRoomPresence) -> String {
  switch presence {
  case .online: "Online"
  case .afk: "Away"
  case .offline: "Offline"
  }
}

extension View {
  /// Pins the mark to an avatar's bottom-trailing corner, two points outside
  /// the face like web's `-right-0.5 -bottom-0.5`.
  func presenceBadge(_ presence: Components.Schemas.ChatRoomPresence, size: CGFloat = 10) -> some View {
    overlay(alignment: .bottomTrailing) {
      PresenceDot(presence: presence, size: size).offset(x: 2, y: 2)
    }
  }

  /// Availability for assistive technology on surfaces whose mark is
  /// decorative; rows without a single subject (group Directs, channels)
  /// pass nil and announce nothing extra.
  @ViewBuilder
  func presenceAccessibilityValue(_ presence: Components.Schemas.ChatRoomPresence?) -> some View {
    if let presence {
      accessibilityValue(presenceLabel(presence))
    } else {
      self
    }
  }
}

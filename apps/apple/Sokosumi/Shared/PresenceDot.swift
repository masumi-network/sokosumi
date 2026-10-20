import CoreAPI
import SwiftUI

/// Web `PresenceDot`: availability as one silhouette per state — a filled
/// disc (online), a crescent (away) and a hollow ring (offline) — so the
/// three stay apart without colour. The mark is decorative; every surface
/// states availability in its own text or accessibility value.
///
/// Web paints the halo, the bite and the offline hole in the ground colour.
/// A Mac sidebar has no single ground (vibrant material, selection pill,
/// hover), so here they are knocked out instead and show whatever is really
/// behind. The halo's `destinationOut` erases everything drawn before it in
/// the enclosing compositing group, so draw the mark inside one: use
/// `presenceBadge`, or put `compositingGroup()` around the faces it sits on.
struct PresenceDot: View {
  let presence: Components.Schemas.ChatRoomPresence
  /// Outer diameter. One point of it is the halo knocked out of the avatar
  /// underneath so the mark reads on top of it.
  var size: CGFloat = 10

  @Environment(\.colorScheme) private var colorScheme

  private var core: CGFloat {
    size - 2
  }

  var body: some View {
    ZStack {
      // Opaque: an unfilled shape takes `.primary`, which erases only 85%.
      Circle().fill(.black).blendMode(.destinationOut)
      mark
        .frame(width: core, height: core)
        // Keeps the bite's knockout to the crescent's own disc.
        .compositingGroup()
    }
    .frame(width: size, height: size)
    .accessibilityHidden(true)
  }

  @ViewBuilder
  private var mark: some View {
    let dark = colorScheme == .dark
    switch presence {
    case .online:
      Circle().fill(Self.success(dark: dark))
    case .afk:
      // The crescent is the disc minus an offset copy of itself, cut out so
      // the bite reads as a bite and not as a dot on a disc.
      Circle().fill(Self.warning(dark: dark))
        .overlay {
          Circle().fill(.black)
            .scaleEffect(0.72)
            .offset(x: core * 0.32, y: -core * 0.32)
            .blendMode(.destinationOut)
        }
    case .offline:
      Circle().strokeBorder(Self.offline(dark: dark), lineWidth: 1)
    }
  }

  /// Web `--semantic-success`, `--semantic-warning` and `--presence-offline`
  /// (globals.css `:root` / `.dark`), converted from HSL.
  private static func success(dark: Bool) -> Color {
    dark ? Color(red: 0.131, green: 0.769, blue: 0.365) : Color(red: 0.076, green: 0.464, blue: 0.218)
  }

  private static func warning(dark: Bool) -> Color {
    dark ? Color(red: 0.982, green: 0.743, blue: 0.138) : Color(red: 0.595, green: 0.262, blue: 0.025)
  }

  private static func offline(dark: Bool) -> Color {
    dark ? Color(red: 0.487, green: 0.54, blue: 0.613) : Color(red: 0.419, green: 0.446, blue: 0.501)
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
  /// the face, its halo cut out of the face.
  func presenceBadge(_ presence: Components.Schemas.ChatRoomPresence, size: CGFloat = 10) -> some View {
    overlay(alignment: .bottomTrailing) {
      PresenceDot(presence: presence, size: size).offset(x: 2, y: 2)
    }
    .compositingGroup()
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

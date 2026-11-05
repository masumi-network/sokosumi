import SwiftUI

extension Color {
  /// Web's `--primary-foreground`, Neutral 950 in both themes: Iris is a fill, and what sits on it is always dark.
  static let onBrand = Color(red: 12 / 255, green: 12 / 255, blue: 12 / 255)
}

extension PrimitiveButtonStyle where Self == BrandPrimaryButtonStyle {
  static var brandPrimary: BrandPrimaryButtonStyle {
    BrandPrimaryButtonStyle()
  }
}

/// `AccentColor` is a neutral on purpose: AppKit always draws white on it (the focused sidebar selection, alert
/// default buttons, checkboxes), and white on Iris is 2.7:1. Anything that should read as Iris uses `BrandSolid`.
///
/// Web's `primary` button. Native `.borderedProminent` chrome, so size, shape, focus and disabled stay the system's,
/// with two things AppKit will not do by itself: the label stays dark (it only honours a style set inside the label,
/// and a default-action button paints the same white-on-accent), and the fill is `BrandSolid` whatever accent the
/// reader picked in System Settings. In dark the resting Dark Iris lifts to full Iris under the pointer.
struct BrandPrimaryButtonStyle: PrimitiveButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    BrandPrimaryButton(configuration: configuration)
  }
}

private struct BrandPrimaryButton: View {
  let configuration: PrimitiveButtonStyleConfiguration
  @Environment(\.isEnabled) private var isEnabled
  @State private var isHovered = false

  private static let irisFlower = Color(red: 1, green: 81 / 255, blue: 1)

  var body: some View {
    Button(action: configuration.trigger) {
      configuration.label.foregroundStyle(Color.onBrand)
    }
    .buttonStyle(.borderedProminent)
    .tint(isHovered && isEnabled ? Self.irisFlower : Color("BrandSolid"))
    .onHover { isHovered = $0 }
  }
}

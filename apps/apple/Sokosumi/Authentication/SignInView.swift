import SokosumiAuth
import SwiftUI

/// Web's `--primary-solid`: #2B5C78 in light, the same hue at 38% lightness (#336D8F) in dark.
enum SignInBrand {
  static let light = (red: 43.0 / 255, green: 92.0 / 255, blue: 120.0 / 255)
  static let dark = (red: 51.0 / 255, green: 109.0 / 255, blue: 143.0 / 255)

  static func color(_ scheme: ColorScheme) -> Color {
    let channel = scheme == .dark ? dark : light
    return Color(red: channel.red, green: channel.green, blue: channel.blue)
  }
}

/// Web's Log in page (`apps/web/src/app/(auth)`): the wordmark, one centered column and the legal footer, with the
/// photo panel beside it once the window is wide enough. Every way in runs through the system browser, where web
/// offers its own methods (email, Google, Microsoft, passkey); Register opens the website's sign-up page.
struct SignInView: View {
  /// The five auth photos, in asset-catalog order.
  static let heroImageNames = ["AuthHero1", "AuthHero2", "AuthHero3", "AuthHero4", "AuthHero5"]

  @EnvironmentObject private var auth: AuthState
  /// Web picks one of five photos per visit; this picks one per window.
  @State private var heroImage = Self.heroImageNames.randomElement() ?? "AuthHero1"

  /// Web shows the panel from `lg` (1024px) on a half-width column; below this the form alone is calmer.
  private static let heroMinimumWidth: CGFloat = 900

  var body: some View {
    GeometryReader { proxy in
      HStack(spacing: 24) {
        VStack(spacing: 24) {
          Image("SokosumiWordmark")
            .resizable()
            .scaledToFit()
            .frame(width: 100, height: 13)
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityLabel("Sokosumi")
          Spacer(minLength: 0)
          SignInColumn()
            .frame(maxWidth: 400)
          Spacer(minLength: 0)
          SignInFooter()
        }
        .frame(maxWidth: .infinity)
        if proxy.size.width >= Self.heroMinimumWidth {
          SignInHeroPanel(imageName: heroImage)
            .frame(width: (proxy.size.width - 24 * 3) / 2)
        }
      }
      .padding(24)
    }
    .frame(minWidth: 420, minHeight: 560)
  }
}

/// The centered column: heading, then the state's body at web's 24pt gap.
private struct SignInColumn: View {
  @EnvironmentObject private var auth: AuthState
  @Environment(\.colorScheme) private var colorScheme
  @ScaledMetric(relativeTo: .largeTitle) private var logInSize = 24.0

  var body: some View {
    VStack(spacing: 24) {
      VStack(spacing: 4) {
        Text("Log in")
          .font(.system(size: logInSize, weight: .light))
          .tracking(-0.4)
          .accessibilityAddTraits(.isHeader)
        Text("Hire agents on our platform")
          .foregroundStyle(.secondary)
      }

      switch auth.status {
      case .notConfigured:
        Text("Sign-in is not configured.")
          .font(.callout)
          .foregroundStyle(.secondary)
        Text("Set the SOKOSUMI_OAUTH_CLIENT_ID environment variable (or the SokosumiOAuthClientID Info.plist key) to the public OAuth client from SOK-970, then relaunch.")
          .font(.callout)
          .foregroundStyle(.secondary)
          .multilineTextAlignment(.center)
      case let .signedOut(message):
        if let message {
          SignInNotice(text: message)
        }
        continueButton
      case .signingIn:
        HStack(spacing: 8) {
          ProgressView()
            .controlSize(.small)
          Text("Waiting for your browser…")
            .foregroundStyle(.secondary)
        }
        .frame(minHeight: 18)
        Button {
          auth.cancelSignIn()
        } label: {
          Text("Cancel")
            .frame(maxWidth: .infinity)
        }
        .controlSize(.extraLarge)
        .keyboardShortcut(.cancelAction)
      case .signedIn:
        EmptyView()
      }

      if showsRegistration {
        registration
      }
      #if DEBUG
        if case .signedOut = auth.status {
          ServerChoiceSection()
            .multilineTextAlignment(.leading)
        }
      #endif
    }
    .multilineTextAlignment(.center)
  }

  /// Register and the terms stay up while the browser is open. The Debug server picker does not: it changes the
  /// issuer, and the attempt already started against the one that was chosen.
  private var showsRegistration: Bool {
    switch auth.status {
    case .signedOut, .signingIn:
      true
    case .notConfigured, .signedIn:
      false
    }
  }

  private var continueButton: some View {
    Button {
      auth.startSignIn()
    } label: {
      Text("Continue in browser")
        .frame(maxWidth: .infinity)
    }
    .buttonStyle(.borderedProminent)
    .tint(SignInBrand.color(colorScheme))
    .controlSize(.extraLarge)
    .keyboardShortcut(.defaultAction)
  }

  private var registration: some View {
    VStack(spacing: 24) {
      HStack(spacing: 4) {
        Text("Don't have an account?")
          .foregroundStyle(.secondary)
        // Accounts are created on the website: the sign-in sheet forgets everything once it closes, and the
        // website's onboarding sets up the new account.
        Link("Register", destination: CoreSettings.signUpURL)
          .buttonStyle(.plain)
          .foregroundStyle(SignInBrand.color(colorScheme))
          .pointerStyle(.link)
      }
      Text(SignInLinks.termsNotice)
        .font(.callout)
        .foregroundStyle(.secondary)
        .tint(.secondary)
        .multilineTextAlignment(.center)
    }
  }
}

/// Web's destructive alert: the reason in red inside a hairline red outline, no icon.
private struct SignInNotice: View {
  let text: String

  var body: some View {
    Text(text)
      .foregroundStyle(.red)
      .multilineTextAlignment(.leading)
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(.horizontal, 16)
      .padding(.vertical, 12)
      .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(.red.opacity(0.4)))
  }
}

enum SignInLinks {
  static let terms = "https://www.sokosumi.com/terms-of-service"
  static let privacy = "https://www.sokosumi.com/privacy-policy"
  static let imprint = "https://www.sokosumi.com/imprint"
  static let acceptableUse = "https://www.sokosumi.com/acceptable-use"

  /// Web's `TermsNotice`: every way of creating an account accepts the terms, so one line says so. Its links are
  /// underlined in the line's own muted color.
  static let termsNotice: AttributedString = {
    var notice = (try? AttributedString(
      markdown: "By creating an account, you agree to the [Terms of Service](\(terms)) and the [Privacy Policy](\(privacy))."
    )) ?? AttributedString("By creating an account, you agree to the Terms of Service and the Privacy Policy.")
    for run in notice.runs where run.link != nil {
      notice[run.range].underlineStyle = .single
    }
    return notice
  }()
}

/// Web's `AuthLayoutFooter`: four quiet legal links that wrap, centered, once the window is too narrow for one row.
private struct SignInFooter: View {
  private static let links: [(title: String, url: String)] = [
    ("Terms of Service", SignInLinks.terms),
    ("Privacy Policy", SignInLinks.privacy),
    ("Imprint", SignInLinks.imprint),
    ("Acceptable Use", SignInLinks.acceptableUse)
  ]

  var body: some View {
    WrappingRow(spacing: 16, centersRows: true) {
      ForEach(Self.links, id: \.url) { link in
        if let url = URL(string: link.url) {
          Link(link.title, destination: url)
            .buttonStyle(.plain)
            .foregroundStyle(.secondary)
            .pointerStyle(.link)
        }
      }
    }
  }
}

/// Web's `AuthBackground` and `AuthAside`, without the logo marquee and the quote: the photo under its scrims,
/// the claim and three lines of proof top left, and the Kanji mark top right. The same in both appearances.
private struct SignInHeroPanel: View {
  let imageName: String

  @ScaledMetric(relativeTo: .largeTitle) private var claimSize = 40.0

  private static let bullets = [
    "Specialized AI coworker built for marketing.",
    "Built for small and large marketing teams.",
    "Works with the tools you already use."
  ]

  var body: some View {
    Color.clear
      .overlay {
        Image(imageName)
          .resizable()
          .scaledToFill()
          .accessibilityHidden(true)
      }
      .overlay {
        GeometryReader { proxy in
          scrim(from: .leading, to: .trailing)
            .frame(width: proxy.size.width * 0.8)
          scrim(from: .top, to: .bottom)
            .frame(height: proxy.size.height * 0.6)
        }
        .accessibilityHidden(true)
      }
      .overlay(alignment: .topLeading) {
        VStack(alignment: .leading, spacing: 40) {
          Text("AI coworkers\nfor marketing")
            .font(.system(size: claimSize, weight: .medium))
            .tracking(-0.8)
            .accessibilityAddTraits(.isHeader)
          VStack(alignment: .leading, spacing: 0) {
            ForEach(Self.bullets, id: \.self) { bullet in
              Text(bullet)
                .font(.title3)
                .foregroundStyle(.white.opacity(0.85))
                .padding(.vertical, 14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .overlay(alignment: .bottom) { Self.hairline }
            }
          }
          .overlay(alignment: .top) { Self.hairline }
        }
        .foregroundStyle(.white)
        .frame(maxWidth: 448, alignment: .leading)
        .padding(40)
      }
      .overlay(alignment: .topTrailing) {
        Image("SokosumiKanji")
          .resizable()
          .scaledToFit()
          .frame(height: 36)
          .foregroundStyle(.white)
          .padding(40)
          .accessibilityLabel("Sokosumi")
      }
      .clipShape(RoundedRectangle(cornerRadius: 12))
      .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(.white.opacity(0.15)))
  }

  private func scrim(from start: UnitPoint, to end: UnitPoint) -> some View {
    LinearGradient(colors: [.black.opacity(0.5), .black.opacity(0.25), .clear], startPoint: start, endPoint: end)
  }

  private static var hairline: some View {
    Rectangle()
      .fill(.white.opacity(0.15))
      .frame(height: 1)
  }
}

import SokosumiAuth
import SwiftUI

struct SignInView: View {
  @EnvironmentObject private var auth: AuthState

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      switch auth.status {
      case .notConfigured:
        Text("Sokosumi")
          .font(.title)
        Text("Sign-in is not configured.")
          .font(.headline)
        Text("Set the SOKOSUMI_OAUTH_CLIENT_ID environment variable (or the SokosumiOAuthClientID Info.plist key) to the public OAuth client from SOK-970, then relaunch.")
          .font(.callout)
          .foregroundStyle(.secondary)
      case let .signedOut(message):
        Text("Sokosumi")
          .font(.title)
        if let message {
          Text(message)
            .foregroundStyle(.secondary)
        }
        Button("Sign in with Sokosumi") {
          auth.startSignIn()
        }
        .buttonStyle(.borderedProminent)
      case .signingIn:
        ProgressView("Contacting Sokosumi…")
        Button("Cancel") {
          auth.cancelSignIn()
        }
        .keyboardShortcut(.cancelAction)
      case .signedIn:
        EmptyView()
      }
    }
    .padding(24)
    .frame(minWidth: 420, minHeight: 180, alignment: .topLeading)
  }
}

import CoreAPI
import SokosumiAuth
import SwiftUI

struct ContentView: View {
  @EnvironmentObject private var auth: AuthState
  @State private var probe = "Not checked yet."

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      Text("Sokosumi")
        .font(.title)
      Text("Core: \(CoreSettings.baseURL.absoluteString)")
        .font(.caption)
        .foregroundStyle(.secondary)
      switch auth.status {
      case .notConfigured:
        Text("Sign-in is not configured.")
          .font(.headline)
        Text("Set the SOKOSUMI_OAUTH_CLIENT_ID environment variable (or the SokosumiOAuthClientID Info.plist key) to the public OAuth client from SOK-970, then relaunch.")
          .font(.callout)
          .foregroundStyle(.secondary)
      case .signedOut(let message):
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
      case .signedIn:
        if let signOutError = auth.signOutError {
          Text(signOutError)
            .foregroundStyle(.red)
        }
        Text(probe)
          .textSelection(.enabled)
        HStack {
          Button("Check session") {
            Task { await probeSession() }
          }
          Button("Sign out") {
            auth.signOut()
          }
        }
      }
    }
    .padding(24)
    .frame(minWidth: 420, minHeight: 180, alignment: .topLeading)
  }

  private func probeSession() async {
    guard let client = auth.coreClient() else {
      probe = "Sign-in is not configured."
      return
    }
    do {
      let response = try await client.getUsersId(path: .init(id: "me"))
      switch response {
      case .ok(let ok):
        let payload = try ok.body.json
        probe = "Signed in as \(payload.data.name) (\(payload.data.email))."
      case .unauthorized(let unauthorized):
        // The middleware already retried with a silent refresh: a 401 here
        // means the refresh is dead, so land on sign-in (SOK-972).
        let payload = try unauthorized.body.json
        auth.signOut(message: "Core rejected the session (\(payload.message)). Sign in again.")
      default:
        probe = "Unexpected Core response: \(String(describing: response))"
      }
    } catch {
      probe = "Core call failed: \(error.localizedDescription)"
    }
  }
}

#Preview {
  ContentView()
    .environmentObject(AuthState(store: PreviewTokenStore()))
}

private struct PreviewTokenStore: TokenStore {
  func load() -> OAuthTokens? { nil }
  func save(_ tokens: OAuthTokens) {}
  func clear() -> Bool { true }
}

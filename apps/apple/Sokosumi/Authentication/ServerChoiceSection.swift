#if DEBUG
  import Combine
  import SokosumiAuth
  import SwiftUI

  /// Debug builds only: which Core and web this app talks to, chosen before
  /// sign-in (a PR preview, local portless). Shown signed out only, because
  /// tokens belong to the issuer that minted them.
  struct ServerChoiceSection: View {
    @EnvironmentObject private var auth: AuthState
    @State private var core = CoreSettings.baseURL.absoluteString
    @State private var web = CoreSettings.webBaseURL.absoluteString

    private var choice: ServerChoice? {
      ServerChoice(core: core, web: web)
    }

    var body: some View {
      VStack(alignment: .leading, spacing: 8) {
        Divider()
        Text("Server (Debug build)")
          .font(.headline)
        LabeledContent("Core API") {
          TextField("Core API", text: $core, prompt: Text("https://api.sokosumi.com/v1"))
            .labelsHidden()
        }
        LabeledContent("Web") {
          TextField("Web", text: $web, prompt: Text("https://app.sokosumi.com"))
            .labelsHidden()
        }
        HStack {
          Button("Apply") {
            apply(choice)
          }
          .disabled(choice == nil || choice == CoreSettings.server)
          Button("Use production") {
            apply(nil)
          }
          .disabled(CoreSettings.server == .production)
        }
      }
      .textFieldStyle(.roundedBorder)
    }

    /// Re-points sign-in first, so Core requests and the issuer never disagree.
    private func apply(_ choice: ServerChoice?) {
      let server = choice ?? .production
      guard let configuration = AppOAuthConfiguration.makeConfiguration(coreBaseURL: server.core),
            auth.reconfigure(configuration) else { return }
      CoreSettings.choose(choice)
      core = server.core.absoluteString
      web = server.web.absoluteString
      // CoreSettings is not observable. Sign-in and Settings read it off this object.
      auth.objectWillChange.send()
    }
  }
#endif

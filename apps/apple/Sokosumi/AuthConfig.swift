import Foundation
import SokosumiAuth

/// Wires `CoreSettings` to the shared auth package.
///
/// The OAuth client ID is the non-secret public client registered by the
/// operator (SOK-970). Provide it via the `SOKOSUMI_OAUTH_CLIENT_ID`
/// environment (Xcode scheme) or the `SokosumiOAuthClientID` Info.plist key.
/// Absent → `.notConfigured`: the UI says so instead of failing silently.
enum AuthConfig {
  static func makeConfiguration() -> OAuthConfiguration? {
    guard let clientID, !clientID.isEmpty else {
      return nil
    }
    return OAuthConfiguration(
      issuerBaseURL: OAuthConfiguration.issuerBaseURL(coreAPIBaseURL: CoreSettings.baseURL),
      clientID: clientID
    )
  }

  static var clientID: String? {
    if let env = ProcessInfo.processInfo.environment["SOKOSUMI_OAUTH_CLIENT_ID"], !env.isEmpty {
      return env
    }
    if let plist = Bundle.main.object(forInfoDictionaryKey: "SokosumiOAuthClientID") as? String,
       !plist.isEmpty {
      return plist
    }
    return nil
  }
}

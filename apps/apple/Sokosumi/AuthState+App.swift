import CoreAPI
import Foundation
import SokosumiAuth
import SokosumiChat

/// App composition only. The shared state does not depend on Core or chat.
extension AuthState {
  convenience init(store: any TokenStore = KeychainTokenStore()) {
    self.init(
      configuration: AuthConfig.makeConfiguration(),
      store: store,
      browser: MacOAuthBrowser(),
      // Test hosts must not read the real Keychain and trigger an ACL prompt.
      restoreSession: NSClassFromString("XCTestCase") == nil
    )
  }

  func coreClient() -> Client? {
    guard let session = oauthSession else { return nil }
    return Client.connecting(
      to: CoreSettings.baseURL,
      middlewares: [
        BearerAuthMiddleware(session: session),
        ExplicitNullPreferredOrganizationMiddleware()
      ]
    )
  }
}

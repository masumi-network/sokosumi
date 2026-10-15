import Foundation
import SokosumiAuth

/// The app's sign-in adapters: its OAuth client, the Keychain and the Mac browser sheet.
extension AuthState {
  convenience init(store: any TokenStore = KeychainTokenStore()) {
    self.init(
      configuration: AppOAuthConfiguration.makeConfiguration(),
      store: store,
      browser: MacOAuthBrowser(),
      // Test hosts must not read the real Keychain and trigger an ACL prompt.
      restoreSession: NSClassFromString("XCTestCase") == nil
    )
  }
}

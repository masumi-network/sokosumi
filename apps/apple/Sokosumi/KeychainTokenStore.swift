import Foundation
import Security
import SokosumiAuth

/// `TokenStore` backed by the login Keychain. App-target only: the shared
/// package must not import `Security` so iOS (and package tests) stay clean.
struct KeychainTokenStore: TokenStore {
  private let service = "com.sokosumi.app.session"
  private let account = "oauth-tokens"

  func load() -> OAuthTokens? {
    var item: CFTypeRef?
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
      kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]
    guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
      let data = item as? Data
    else {
      return nil
    }
    return try? JSONDecoder().decode(OAuthTokens.self, from: data)
  }

  func save(_ tokens: OAuthTokens) {
    guard let data = try? JSONEncoder().encode(tokens) else {
      return
    }
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
    ]
    let attributes: [String: Any] = [
      kSecValueData as String: data,
      kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock,
    ]
    if SecItemCopyMatching(query as CFDictionary, nil) == errSecSuccess {
      SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
    } else {
      SecItemAdd((query.merging(attributes) { _, new in new }) as CFDictionary, nil)
    }
  }

  func clear() {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
    ]
    SecItemDelete(query as CFDictionary)
  }
}

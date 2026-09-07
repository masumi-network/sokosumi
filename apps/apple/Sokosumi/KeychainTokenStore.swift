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

  func save(_ tokens: OAuthTokens) throws {
    guard let data = try? JSONEncoder().encode(tokens) else {
      throw TokenStoreError.encodingFailed
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
    let status: OSStatus
    if SecItemCopyMatching(query as CFDictionary, nil) == errSecSuccess {
      status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
    } else {
      status = SecItemAdd((query.merging(attributes) { _, new in new }) as CFDictionary, nil)
    }
    guard status == errSecSuccess else {
      throw TokenStoreError.writeFailed
    }
  }

  @discardableResult
  func clear() -> Bool {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
    ]
    let status = SecItemDelete(query as CFDictionary)
    // Absent already counts as deleted (idempotent sign-out). Any other
    // failure leaves the item in place and must report false.
    return status == errSecSuccess || status == errSecItemNotFound
  }
}

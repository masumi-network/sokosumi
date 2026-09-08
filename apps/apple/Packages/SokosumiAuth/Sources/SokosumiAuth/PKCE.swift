import CryptoKit
import Foundation

/// PKCE (RFC 7636) helpers for the public Mac OAuth client (no client secret).
public enum PKCE {
  /// A fresh `code_verifier`: 32 random bytes, base64url-encoded (43 chars).
  public static func generateVerifier() -> String {
    var generator = SystemRandomNumberGenerator()
    let bytes = (0 ..< 32).map { _ in UInt8.random(in: .min ... .max, using: &generator) }
    return base64URLEncode(Data(bytes))
  }

  /// `code_challenge` for a verifier: `BASE64URL(SHA256(verifier))`, no padding.
  public static func challenge(forVerifier verifier: String) -> String {
    let digest = SHA256.hash(data: Data(verifier.utf8))
    return base64URLEncode(Data(digest))
  }

  static func base64URLEncode(_ data: Data) -> String {
    data
      .base64EncodedString()
      .replacingOccurrences(of: "+", with: "-")
      .replacingOccurrences(of: "/", with: "_")
      .replacingOccurrences(of: "=", with: "")
  }
}

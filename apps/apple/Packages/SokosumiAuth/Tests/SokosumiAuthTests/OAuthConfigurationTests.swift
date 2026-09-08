import Foundation
import SokosumiAuth
import Testing

struct OAuthConfigurationTests {
  @Test func authorizeURLCarriesPublicPKCEParameters() throws {
    let configuration = try OAuthConfiguration(
      issuerBaseURL: #require(URL(string: "https://core.example/auth")),
      clientID: "mac-public-client"
    )
    let url = try configuration.authorizeURL(
      state: "state-123",
      codeChallenge: "challenge-abc"
    )

    let components = try #require(URLComponents(url: url, resolvingAgainstBaseURL: false))
    #expect(components.scheme == "https")
    #expect(components.host == "core.example")
    #expect(components.path == "/auth/oauth2/authorize")
    let fields = Dictionary(
      uniqueKeysWithValues: (components.queryItems ?? []).map { ($0.name, $0.value) }
    )
    #expect(fields["response_type"] == "code")
    #expect(fields["client_id"] == "mac-public-client")
    #expect(fields["redirect_uri"] == "com.sokosumi.app:/auth")
    #expect(fields["scope"] == "openid sokosumi:api offline_access")
    #expect(fields["code_challenge"] == "challenge-abc")
    #expect(fields["code_challenge_method"] == "S256")
    #expect(fields["state"] == "state-123")
  }

  @Test func issuerBaseDerivesFromCoreAPIBaseURL() throws {
    #expect(
      try OAuthConfiguration.issuerBaseURL(
        coreAPIBaseURL: #require(URL(string: "https://api.sokosumi.com/v1"))
      ).absoluteString == "https://api.sokosumi.com/auth"
    )
    #expect(
      try OAuthConfiguration.issuerBaseURL(
        coreAPIBaseURL: #require(URL(string: "https://xyz.core.sokosumi.localhost/v1"))
      ).absoluteString == "https://xyz.core.sokosumi.localhost/auth"
    )
  }

  @Test func pkceChallengeIsBase64URLSHA256() {
    // FIPS 180-4 "abc" digest, base64url-encoded without padding.
    // Expected value computed independently (openssl/python), not by this code.
    #expect(
      PKCE.challenge(forVerifier: "abc")
        == "ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0"
    )
  }

  @Test func generatedVerifierIsURLSafeAndLongEnough() {
    let verifier = PKCE.generateVerifier()
    #expect(verifier.count >= 43)
    #expect(verifier.count <= 128)
    let allowed = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")
    #expect(verifier.unicodeScalars.allSatisfy { allowed.contains($0) })
    #expect(PKCE.generateVerifier() != verifier)
  }
}

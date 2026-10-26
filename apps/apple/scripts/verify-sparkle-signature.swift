// Verifies a Sparkle EdDSA signature over a file with a public key, the way an
// installed app checks an update before it installs it. Sparkle's own
// `sign_update --verify` only accepts the private key, so it cannot prove the
// key baked into shipped apps (SUPublicEDKey) accepts the update.
//
//   swift verify-sparkle-signature.swift <public-key-b64> <signature-b64> <file>

import CryptoKit
import Foundation

let args = CommandLine.arguments
guard args.count == 4,
      let keyData = Data(base64Encoded: args[1]),
      let signature = Data(base64Encoded: args[2]),
      let key = try? Curve25519.Signing.PublicKey(rawRepresentation: keyData)
else {
  FileHandle.standardError.write(Data("usage: verify-sparkle-signature.swift <public-key-b64> <signature-b64> <file>\n".utf8))
  exit(2)
}

let data = try Data(contentsOf: URL(fileURLWithPath: args[3]), options: .mappedIfSafe)
guard key.isValidSignature(signature, for: data) else {
  FileHandle.standardError.write(Data("the EdDSA signature does not verify against the public key\n".utf8))
  exit(1)
}

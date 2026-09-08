import Foundation

enum CoreSettings {
  /// Resolution order: `SOKOSUMI_CORE_BASE_URL` environment (local portless
  /// Core, e.g. `$(pnpm portless:url core)/v1`), then the
  /// `SokosumiCoreBaseURL` Info.plist key, then production.
  /// All values include `/v1`.
  static var baseURL: URL {
    if let raw = ProcessInfo.processInfo.environment["SOKOSUMI_CORE_BASE_URL"],
       let url = URL(string: raw) {
      return url
    }
    if let plist = Bundle.main.object(forInfoDictionaryKey: "SokosumiCoreBaseURL") as? String,
       let url = URL(string: plist) {
      return url
    }
    return URL(string: "https://api.sokosumi.com/v1")!
  }
}

import Foundation

enum CoreSettings {
  /// Override with `SOKOSUMI_CORE_BASE_URL` (include `/v1`).
  /// Local: `$(pnpm portless:url core)/v1`.
  static var baseURL: URL {
    if let raw = ProcessInfo.processInfo.environment["SOKOSUMI_CORE_BASE_URL"],
      let url = URL(string: raw)
    {
      return url
    }
    return URL(string: "https://api.sokosumi.com/v1")!
  }
}

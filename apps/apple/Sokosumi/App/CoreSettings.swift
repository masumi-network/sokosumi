import CoreAPI
import Foundation

enum CoreSettings {
  /// Resolution order: `SOKOSUMI_CORE_BASE_URL` environment (local portless
  /// Core, e.g. `$(pnpm portless:url core)/v1`), then the
  /// `SokosumiCoreBaseURL` Info.plist key, then production.
  /// All values include `/v1`.
  static var baseURL: URL {
    url(
      environment: ProcessInfo.processInfo.environment["SOKOSUMI_CORE_BASE_URL"],
      plist: Bundle.main.object(forInfoDictionaryKey: "SokosumiCoreBaseURL") as? String,
      fallback: "https://api.sokosumi.com/v1"
    )
  }

  /// Resolution order: `SOKOSUMI_WEB_BASE_URL` environment (local portless
  /// web, e.g. `$(pnpm portless:url web)`), then the `SokosumiWebBaseURL`
  /// Info.plist key, then production. Origin only, no path.
  static var webBaseURL: URL {
    url(
      environment: ProcessInfo.processInfo.environment["SOKOSUMI_WEB_BASE_URL"],
      plist: Bundle.main.object(forInfoDictionaryKey: "SokosumiWebBaseURL") as? String,
      fallback: "https://app.sokosumi.com"
    )
  }

  /// Names this build on every Core request (ADR 0053). Build 1, the project
  /// default, marks a local build that Core never turns away.
  static var clientBuildMiddleware: ClientBuildMiddleware {
    ClientBuildMiddleware(
      channel: distributionChannel,
      build: Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "1"
    )
  }

  /// `SokosumiDistributionChannel` from the Info.plist: `developer-id` only in
  /// the published download, `app-store` for every other build.
  static var distributionChannel: DistributionChannel {
    (Bundle.main.object(forInfoDictionaryKey: "SokosumiDistributionChannel") as? String)
      .flatMap(DistributionChannel.init(rawValue:)) ?? .appStore
  }

  static var setupURL: URL {
    setupURL(from: webBaseURL)
  }

  static func setupURL(from webBaseURL: URL) -> URL {
    webBaseURL.appending(path: "setup")
  }

  static func url(environment: String?, plist: String?, fallback: String) -> URL {
    if let raw = environment, let url = URL(string: raw) {
      return url
    }
    if let raw = plist, let url = URL(string: raw) {
      return url
    }
    return URL(string: fallback)!
  }
}

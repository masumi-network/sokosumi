import CoreAPI
import Foundation

enum CoreSettings {
  // Debug builds may point at another server (a PR preview, local portless)
  // from the sign-in screen. Release always talks to production.
  #if DEBUG
    static let allowsServerChoice = true
  #else
    static let allowsServerChoice = false
  #endif

  /// Read once per launch; `choose(_:)` replaces it.
  private(set) static var server = resolve(saved: .saved(in: .standard), allowsOverride: allowsServerChoice)

  /// Includes `/v1`.
  static var baseURL: URL {
    server.core
  }

  /// Origin only, no path.
  static var webBaseURL: URL {
    server.web
  }

  /// Saves a debug build's choice; nil returns to production. Re-point `AuthState` first:
  /// its issuer is not read from here.
  static func choose(_ choice: ServerChoice?) {
    guard allowsServerChoice else { return }
    if let choice {
      choice.save(to: .standard)
    } else {
      ServerChoice.clear(in: .standard)
    }
    server = choice ?? .production
  }

  static func resolve(saved: ServerChoice?, allowsOverride: Bool) -> ServerChoice {
    allowsOverride ? saved ?? .production : .production
  }

  /// This build, named on every Core request (ADR 0053). Build 1, the project
  /// default, marks a local build that Core never turns away.
  static var build: String {
    Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "1"
  }

  static var setupURL: URL {
    setupURL(from: webBaseURL)
  }

  static func setupURL(from webBaseURL: URL) -> URL {
    webBaseURL.appending(path: "setup")
  }

  /// Register on the website: the app's sign-in sheet forgets everything once
  /// it closes, and the website's onboarding sets up the new account.
  static var signUpURL: URL {
    signUpURL(from: webBaseURL)
  }

  static func signUpURL(from webBaseURL: URL) -> URL {
    webBaseURL.appending(path: "signup")
  }
}

/// The Core API (including `/v1`) and web origin one build talks to.
struct ServerChoice: Equatable {
  static let production = ServerChoice(
    core: URL(string: "https://api.sokosumi.com/v1")!,
    web: URL(string: "https://app.sokosumi.com")!
  )

  let core: URL
  let web: URL

  private init(core: URL, web: URL) {
    self.core = core
    self.web = web
  }

  /// Typed input: both must be http(s) URLs with a host. A Core URL without a
  /// path gets `/v1`, because a bare origin 404s every request into the Update screen.
  /// The web URL keeps only its origin: setup and sign-up links append to it.
  init?(core: String, web: String) {
    guard var core = Self.components(core), var web = Self.components(web) else { return nil }
    if core.path.isEmpty || core.path == "/" {
      core.path = "/v1"
    }
    web.path = ""
    web.query = nil
    web.fragment = nil
    guard let coreURL = core.url, let webURL = web.url else { return nil }
    self.init(core: coreURL, web: webURL)
  }

  private static let defaultsKey = "sokosumi.server-choice.v1"

  static func saved(in defaults: UserDefaults) -> ServerChoice? {
    guard let saved = defaults.dictionary(forKey: defaultsKey) as? [String: String],
          let core = saved["core"], let web = saved["web"] else { return nil }
    return ServerChoice(core: core, web: web)
  }

  func save(to defaults: UserDefaults) {
    defaults.set(["core": core.absoluteString, "web": web.absoluteString], forKey: Self.defaultsKey)
  }

  static func clear(in defaults: UserDefaults) {
    defaults.removeObject(forKey: defaultsKey)
  }

  private static func components(_ raw: String) -> URLComponents? {
    guard let components = URLComponents(string: raw.trimmingCharacters(in: .whitespaces)),
          ["http", "https"].contains(components.scheme?.lowercased()),
          components.host?.isEmpty == false else { return nil }
    return components
  }
}

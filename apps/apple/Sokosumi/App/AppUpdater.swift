import Combine
import Sparkle

/// Sparkle's standard updater for the published download (ADR 0054): a daily
/// check of the `macos-latest` appcast, the standard prompt with release notes,
/// **Check for Updates…** in the app menu and an Updates switch in Settings. Feed, key and schedule come from
/// the Info.plist. Only `Publish macOS DMG` compiles it in (`SOKOSUMI_UPDATER=YES`);
/// ad hoc, Debug and local builds never start it and show no menu item.
final class AppUpdater: ObservableObject {
  /// True only in the publish build. The updater code below compiles in every
  /// build, so pull requests type-check it too.
  static let isPublishBuild: Bool = {
    #if SOKOSUMI_UPDATER
      true
    #else
      false
    #endif
  }()

  @Published private(set) var canCheckForUpdates = false
  /// Settings → Updates. Sparkle keeps the choice in the app's defaults; the Info.plist only sets the default.
  @Published var automaticallyChecksForUpdates = false {
    didSet { controller?.updater.automaticallyChecksForUpdates = automaticallyChecksForUpdates }
  }

  private let controller: SPUStandardUpdaterController?

  init() {
    guard Self.isPublishBuild else {
      controller = nil
      return
    }
    let controller = SPUStandardUpdaterController(startingUpdater: true, updaterDelegate: nil, userDriverDelegate: nil)
    self.controller = controller
    automaticallyChecksForUpdates = controller.updater.automaticallyChecksForUpdates
    controller.updater.publisher(for: \.canCheckForUpdates).assign(to: &$canCheckForUpdates)
  }

  func checkForUpdates() {
    controller?.checkForUpdates(nil)
  }
}

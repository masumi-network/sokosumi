import Combine
import Sparkle

/// Sparkle's standard updater for the published download (ADR 0054): a daily
/// check of the `macos-latest` appcast, the standard prompt with release notes,
/// and **Check for Updates…** in the app menu. Feed, key and schedule come from
/// the Info.plist. Only `Publish macOS DMG` compiles it in (`SOKOSUMI_UPDATER=YES`);
/// ad hoc, Debug and local builds never start it and show no menu item.
final class AppUpdater: ObservableObject {
  /// True only in the publish build. The updater code below compiles in every
  /// build, so pull requests type-check it too.
  static var isCompiledIn: Bool {
    #if SOKOSUMI_UPDATER
      true
    #else
      false
    #endif
  }

  @Published private(set) var canCheckForUpdates = false
  private let controller: SPUStandardUpdaterController?

  init(enabled: Bool = AppUpdater.isCompiledIn) {
    guard enabled else {
      controller = nil
      return
    }
    let controller = SPUStandardUpdaterController(startingUpdater: true, updaterDelegate: nil, userDriverDelegate: nil)
    self.controller = controller
    controller.updater.publisher(for: \.canCheckForUpdates).assign(to: &$canCheckForUpdates)
  }

  var isEnabled: Bool {
    controller != nil
  }

  func checkForUpdates() {
    controller?.checkForUpdates(nil)
  }
}

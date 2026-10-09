import Combine
import CoreAPI
import Sparkle

/// Sparkle's standard updater for the Developer ID download (ADR 0053): a daily
/// check of the `macos-latest` appcast, the standard prompt with release notes,
/// and **Check for Updates…** in the app menu. Feed, key and schedule come from
/// the Info.plist. Every other build (ad hoc, Debug, local) never starts it and
/// shows no menu item.
final class AppUpdater: ObservableObject {
  @Published private(set) var canCheckForUpdates = false
  private let controller: SPUStandardUpdaterController?

  init(channel: DistributionChannel) {
    guard channel == .developerID else {
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

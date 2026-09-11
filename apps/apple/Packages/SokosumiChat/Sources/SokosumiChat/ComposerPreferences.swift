import Foundation

public struct ComposerPreferences {
  private let defaults: UserDefaults
  private static let toolbarKey = "sokosumi.format-toolbar-open.v1"

  public init(defaults: UserDefaults = .standard) {
    self.defaults = defaults
  }

  public var toolbarVisible: Bool {
    get { defaults.object(forKey: Self.toolbarKey) as? Bool ?? true }
    nonmutating set { defaults.set(newValue, forKey: Self.toolbarKey) }
  }
}

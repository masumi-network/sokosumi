import SokosumiChat
import SwiftUI

extension EnvironmentValues {
  /// The reader's clock preference for chat timestamps. `SokosumiApp` injects
  /// the stored value once per window, so rows do not each observe `UserDefaults`.
  @Entry var timeFormat: TimeFormatPreference = .auto
}

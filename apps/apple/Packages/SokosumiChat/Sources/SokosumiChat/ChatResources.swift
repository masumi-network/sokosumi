import Foundation

/// The library target's own resource bundle.
///
/// Call sites use this instead of `Bundle.module` directly. `Bundle.module` is
/// generated per target, so once `SokosumiChatTests` gained resources of its own
/// its accessor shadowed this one through `@testable import SokosumiChat`, and
/// tests reading `Emoji` or `GrammarDependencies` looked in the wrong bundle.
enum ChatResources {
  static let bundle = Bundle.module
}

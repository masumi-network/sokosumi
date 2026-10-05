import Foundation

/// The step-back every other message row of a list takes while the list holds a jump mark: web's spotlight
/// (`chat-jump-dim` and `chat-jump-undim` in globals.css). It runs on the mark's clock and never outlives it: the
/// rows step back over the hold's opening, stay back, and return over its closing, or over the leave fade a
/// reader scroll starts. Reduced motion has none, as web's `prefers-reduced-motion` block drops it.
public struct JumpSpotlight: Equatable, Sendable {
  public let opacity: Double
  /// In points, as web's is in CSS pixels.
  public let blurRadius: Double

  /// A row at rest.
  public static let none = JumpSpotlight(opacity: 1, blurRadius: 0)

  /// All the way back: web's `--chat-jump-dim-opacity` and `--chat-jump-dim-blur`. Dark takes more of both,
  /// because pulling opacity down on a dark ground takes far less contrast out of the text than it does on white.
  static func steppedBack(dark: Bool) -> JumpSpotlight {
    dark ? JumpSpotlight(opacity: 0.36, blurRadius: 2.5) : JumpSpotlight(opacity: 0.5, blurRadius: 1.5)
  }

  /// Where the other rows stand at `stage` of their list's mark. `easing` maps a stretch's linear progress onto
  /// the drawing's curve; web's keyframes run `ease-out` between their stops.
  public init(stage: JumpMark.Stage, dark: Bool, reduceMotion: Bool, easing: (Double) -> Double) {
    let depth: Double = if reduceMotion {
      0
    } else {
      switch stage {
      case let .opening(progress): easing(progress)
      case .full: 1
      // The leave fade only starts from full strength, where the hold keeps the rows stepped back.
      case let .closing(progress), let .leaving(progress): 1 - easing(progress)
      case .ended: 0
      }
    }
    let back = Self.steppedBack(dark: dark)
    self.init(opacity: (1 - depth) + depth * back.opacity, blurRadius: depth * back.blurRadius)
  }

  private init(opacity: Double, blurRadius: Double) {
    self.opacity = opacity
    self.blurRadius = blurRadius
  }
}

import Foundation

/// Web's image-viewer zoom (`image-viewer.tsx` `MIN_ZOOM`, `MAX_ZOOM`, `ZOOM_STEP`): 25 % to 400 %
/// in 25 % steps from 100 %; reset returns to 100 %. The viewer keeps one per shown image.
public struct ImageViewerZoom: Equatable, Sendable {
  public static let minimum = 0.25
  public static let maximum = 4.0
  public static let step = 0.25

  public private(set) var scale: Double

  public init(scale: Double = 1) {
    self.scale = Self.clamped(scale)
  }

  /// Web disables Zoom in at the maximum and Zoom out at the minimum; reset stays enabled.
  public var canZoomIn: Bool {
    scale < Self.maximum
  }

  public var canZoomOut: Bool {
    scale > Self.minimum
  }

  public mutating func zoomIn() {
    scale = Self.clamped(scale + Self.step)
  }

  public mutating func zoomOut() {
    scale = Self.clamped(scale - Self.step)
  }

  public mutating func reset() {
    scale = 1
  }

  /// A trackpad pinch that began at `start`, inside the same limits (Apple only: web leaves a pinch
  /// to the browser's page zoom).
  public static func magnified(_ start: ImageViewerZoom, by magnification: Double) -> ImageViewerZoom {
    ImageViewerZoom(scale: start.scale * magnification)
  }

  private static func clamped(_ scale: Double) -> Double {
    min(maximum, max(minimum, scale))
  }
}

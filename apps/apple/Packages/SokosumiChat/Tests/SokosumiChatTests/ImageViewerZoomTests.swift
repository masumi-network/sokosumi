import SokosumiChat
import Testing

/// Row 15a2a: web's image-viewer zoom (`image-viewer.tsx` `MIN_ZOOM` 0.25, `MAX_ZOOM` 4,
/// `ZOOM_STEP` 0.25, reset to 1, the limit buttons disabled). No clock or ids involved.
struct ImageViewerZoomTests {
  /// Web opens every image at 100 %, with both directions available.
  @Test func startsAtActualSize() {
    let zoom = ImageViewerZoom()
    #expect(zoom.scale == 1)
    #expect(zoom.canZoomIn)
    #expect(zoom.canZoomOut)
  }

  /// Web: Zoom in adds 25 % up to 400 %, where the button disables and further presses do nothing.
  @Test func zoomsInByAQuarterUpToFourTimes() {
    var zoom = ImageViewerZoom()
    zoom.zoomIn()
    #expect(zoom.scale == 1.25)
    var scales: [Double] = []
    for _ in 0 ..< 14 {
      zoom.zoomIn()
      scales.append(zoom.scale)
    }
    #expect(scales.prefix(11) == [1.5, 1.75, 2, 2.25, 2.5, 2.75, 3, 3.25, 3.5, 3.75, 4])
    #expect(zoom.scale == 4, "Clamped at the maximum.")
    #expect(!zoom.canZoomIn)
    #expect(zoom.canZoomOut)
  }

  /// Web: Zoom out takes 25 % off down to 25 %, where the button disables.
  @Test func zoomsOutByAQuarterDownToAQuarter() {
    var zoom = ImageViewerZoom()
    zoom.zoomOut()
    #expect(zoom.scale == 0.75)
    zoom.zoomOut()
    zoom.zoomOut()
    #expect(zoom.scale == 0.25)
    #expect(!zoom.canZoomOut)
    #expect(zoom.canZoomIn)
    zoom.zoomOut()
    #expect(zoom.scale == 0.25, "Clamped at the minimum.")
  }

  /// Web's reset returns to 100 % from anywhere and is never disabled.
  @Test func resetReturnsToActualSize() {
    var zoom = ImageViewerZoom()
    for _ in 0 ..< 5 {
      zoom.zoomIn()
    }
    zoom.reset()
    #expect(zoom == ImageViewerZoom())
    zoom.zoomOut()
    zoom.reset()
    #expect(zoom.scale == 1)
    zoom.reset()
    #expect(zoom.scale == 1, "Reset at 100 % stays there.")
  }

  /// Any scale handed in is kept inside web's limits.
  @Test func clampsAScaleHandedIn() {
    #expect(ImageViewerZoom(scale: 9).scale == 4)
    #expect(ImageViewerZoom(scale: 0.1).scale == 0.25)
    #expect(ImageViewerZoom(scale: 1.5).scale == 1.5)
  }

  /// Apple's trackpad pinch multiplies the scale it began at, inside the same limits; a step after
  /// it adds web's 25 %, as web's arithmetic does.
  @Test func aPinchScalesFromItsStartWithinTheLimits() {
    let start = ImageViewerZoom(scale: 2)
    #expect(ImageViewerZoom.magnified(start, by: 0.5).scale == 1)
    #expect(ImageViewerZoom.magnified(start, by: 1.5).scale == 3)
    #expect(ImageViewerZoom.magnified(start, by: 10).scale == 4)
    #expect(ImageViewerZoom.magnified(start, by: 0.01).scale == 0.25)
    #expect(ImageViewerZoom.magnified(start, by: -1).scale == 0.25, "A degenerate magnification stays in range.")
    var pinched = ImageViewerZoom.magnified(ImageViewerZoom(), by: 1.1)
    pinched.zoomIn()
    #expect(abs(pinched.scale - 1.35) < 0.000_001)
  }
}

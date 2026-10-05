#if os(macOS)
  import AppKit
  import Testing

  /// SwiftUI mounting and layout are asynchronous even after a window is ordered front.
  @MainActor
  func waitForView<V: NSView>(
    in host: NSView,
    timeoutMessage: @autoclosure () -> String,
    sourceLocation: SourceLocation = #_sourceLocation,
    _ readyView: () -> V?
  ) async throws -> V {
    let clock = ContinuousClock()
    let deadline = clock.now.advanced(by: .seconds(10))
    repeat {
      host.layoutSubtreeIfNeeded()
      if let view = readyView() {
        return view
      }
      try await Task.sleep(for: .milliseconds(20))
    } while clock.now < deadline

    host.layoutSubtreeIfNeeded()
    return try #require(readyView(), "Timed out after 10 seconds: \(timeoutMessage())", sourceLocation: sourceLocation)
  }

  /// The test host is never the active app, so AppKit delivers no tracking events: enter the hosting view's
  /// tracking areas and move to `point` (in `host`'s coordinates) by hand.
  @MainActor
  func hover(_ point: NSPoint, in host: NSView, window: NSWindow) async throws {
    let location = host.convert(point, to: nil)
    func trackingAreas(_ view: NSView) -> [NSTrackingArea] {
      view.trackingAreas + view.subviews.flatMap(trackingAreas)
    }
    for area in trackingAreas(host) {
      let entered = try #require(NSEvent.enterExitEvent(
        with: .mouseEntered, location: location, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
        windowNumber: window.windowNumber, context: nil, eventNumber: 0,
        trackingNumber: Int(bitPattern: Unmanaged.passUnretained(area).toOpaque()), userData: nil
      ))
      (area.owner as? NSResponder)?.mouseEntered(with: entered)
    }
    let moved = try #require(NSEvent.mouseEvent(
      with: .mouseMoved, location: location, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
      windowNumber: window.windowNumber, context: nil, eventNumber: 0, clickCount: 0, pressure: 0
    ))
    host.mouseMoved(with: moved)
    try await Task.sleep(for: .milliseconds(300))
  }
#endif

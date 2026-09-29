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
#endif

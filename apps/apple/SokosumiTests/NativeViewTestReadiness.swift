#if os(macOS)
  import AppKit
  import Testing

  /// SwiftUI mounting and layout are asynchronous even after a window is ordered front.
  @MainActor
  func waitForView<V: NSView>(in host: NSView, _ readyView: () -> V?) async throws -> V {
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
    return try #require(readyView(), "Expected view did not become ready within 10 seconds")
  }
#endif

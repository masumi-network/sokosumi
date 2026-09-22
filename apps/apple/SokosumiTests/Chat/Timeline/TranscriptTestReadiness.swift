#if os(macOS)
  import AppKit
  import Testing

  /// Preparation is asynchronous; a fixed sleep can find only the composer
  /// or the thread's loading view on a busy CI host.
  @MainActor
  func loadedTranscriptScrollView(in host: NSView) async throws -> NSScrollView {
    func scrollViews(_ view: NSView) -> [NSScrollView] {
      (view as? NSScrollView).map { [$0] } ?? view.subviews.flatMap(scrollViews)
    }

    func isReady(_ scroll: NSScrollView) -> Bool {
      scroll.contentInsets.bottom > 0 && (scroll.documentView?.frame.height ?? 0) > scroll.frame.height
    }

    return try await waitForView(in: host) {
      guard let scroll = scrollViews(host).max(by: { $0.frame.height < $1.frame.height }), isReady(scroll) else {
        return nil
      }
      return scroll
    }
  }
#endif

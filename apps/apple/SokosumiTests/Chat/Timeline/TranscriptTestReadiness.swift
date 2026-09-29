#if os(macOS)
  import AppKit
  import Testing // Required by waitForView's default source-location macro at the call site.

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

    var transcript: NSScrollView?
    return try await waitForView(in: host, timeoutMessage: transcript.map {
      "Prepared transcript did not finish initial layout: bottom inset \($0.contentInsets.bottom), document height \($0.documentView?.frame.height ?? 0), viewport height \($0.frame.height)"
    } ?? "Prepared transcript did not appear") {
      transcript = scrollViews(host).max(by: { $0.frame.height < $1.frame.height })
      guard let scroll = transcript, isReady(scroll) else {
        return nil
      }
      return scroll
    }
  }
#endif

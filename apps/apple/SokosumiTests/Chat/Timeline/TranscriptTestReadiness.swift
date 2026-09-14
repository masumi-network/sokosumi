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

    let clock = ContinuousClock()
    let deadline = clock.now.advanced(by: .seconds(10))
    var transcript: NSScrollView?
    repeat {
      host.layoutSubtreeIfNeeded()
      transcript = scrollViews(host).max(by: { $0.frame.height < $1.frame.height })
      if let transcript, isReady(transcript) {
        return transcript
      }
      try await Task.sleep(for: .milliseconds(20))
    } while clock.now < deadline

    let scroll = try #require(transcript, "Prepared transcript did not appear within 10 seconds")
    try #require(isReady(scroll), "Prepared transcript did not finish initial layout within 10 seconds")
    return scroll
  }
#endif

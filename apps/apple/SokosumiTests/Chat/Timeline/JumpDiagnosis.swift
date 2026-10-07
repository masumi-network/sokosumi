#if os(macOS)
  import AppKit
  import SokosumiWorkspace
  import Testing

  /// What a hosted jump test saw, kept in memory and attached only when it fails: a capture of the window and the
  /// numbers behind it at each step, so a failure on a runner nobody can watch shows what it read (row 25b2's CI
  /// follow-up).
  @MainActor final class JumpDiagnosis {
    /// Columns the pixel reads use: left of the avatars (the room's rail and wash) and right of the text (the wash
    /// in either list).
    private static let columns: [CGFloat] = [6, 700]

    private let state: WorkspaceState
    private let host: NSView
    private let scroll: NSScrollView
    private var steps: [Step] = []

    private struct Step {
      let label: String
      let png: Data?
      let text: String
    }

    init(state: WorkspaceState, host: NSView, scroll: NSScrollView) {
      self.state = state
      self.host = host
      self.scroll = scroll
    }

    /// Keeps what the window shows now under `label`.
    func snap(_ label: String) {
      host.layoutSubtreeIfNeeded()
      let bitmap = host.bitmapImageRepForCachingDisplay(in: host.bounds)
      if let bitmap {
        host.cacheDisplay(in: host.bounds, to: bitmap)
      }
      steps.append(Step(label: label, png: bitmap?.representation(using: .png, properties: [:]), text: describe(bitmap)))
    }

    /// Attaches every step kept so far, and one more for `reason`.
    func attach(_ reason: String) {
      snap(reason)
      for (index, step) in steps.enumerated() {
        let name = "jump-\(index)-\(step.label.replacingOccurrences(of: " ", with: "-"))"
        if let png = step.png {
          Attachment.record(png, named: "\(name).png")
        }
        Attachment.record(step.text, named: "\(name).txt")
      }
      steps.removeAll()
    }

    private func describe(_ bitmap: NSBitmapImageRep?) -> String {
      let window = host.window
      let thread = state.thread.timeline
      var lines = [
        "scroll offset \(scroll.contentView.bounds.minY), viewport \(scroll.contentView.bounds.size), document \(scroll.documentView?.frame.size ?? .zero), insets \(scroll.contentInsets)",
        "window \(window?.frame ?? .zero), screen \(window?.screen?.frame ?? .zero) visible \(window?.screen?.visibleFrame ?? .zero), backing scale \(window?.backingScaleFactor ?? 0)",
        "pointer \(NSEvent.mouseLocation), reduce motion \(NSWorkspace.shared.accessibilityDisplayShouldReduceMotion)",
        "thread jump \(String(describing: state.thread.jumpTarget))",
        "thread timeline loading \(thread.isLoading), loading older \(thread.isLoadingOlder), has more \(thread.hasMore), error \(thread.errorMessage ?? "none")",
        "room historical anchor \(state.timeline.historicalAnchor ?? "none"), room loading older \(state.timeline.isLoadingOlder)"
      ]
      if let bitmap {
        lines += Self.columns.map { "column \(Int($0)) runs differing from the viewport's top row (pt from its top): \(runs(in: bitmap, column: $0))" }
      }
      return lines.joined(separator: "\n")
    }

    /// Runs of viewport rows whose colour at `column` differs from the viewport's top row, in points.
    private func runs(in bitmap: NSBitmapImageRep, column: CGFloat) -> String {
      let scale = CGFloat(bitmap.pixelsWide) / host.bounds.width
      var frame = scroll.convert(scroll.bounds, to: host)
      if !host.isFlipped {
        frame.origin.y = host.bounds.height - frame.maxY
      }
      let top = Int((frame.minY + 2) * scale), bottom = Int((frame.maxY - scroll.contentInsets.bottom - 2) * scale)
      let pixelX = Int(column * scale)
      guard top < bottom, let reference = bitmap.colorAt(x: pixelX, y: top)?.usingColorSpace(.deviceRGB) else { return "none read" }
      var runs: [String] = [], start: Int?
      for pixelY in top ... bottom {
        let color = pixelY < bottom ? bitmap.colorAt(x: pixelX, y: pixelY)?.usingColorSpace(.deviceRGB) : nil
        let differs = color.map {
          abs($0.redComponent - reference.redComponent) + abs($0.greenComponent - reference.greenComponent)
            + abs($0.blueComponent - reference.blueComponent) > 0.04
        } ?? false
        if differs, start == nil {
          start = pixelY
        } else if !differs, let first = start {
          runs.append("\(Int(CGFloat(first - top) / scale))-\(Int(CGFloat(pixelY - top) / scale))")
          start = nil
        }
      }
      return runs.isEmpty ? "none" : runs.joined(separator: ", ")
    }
  }
#endif

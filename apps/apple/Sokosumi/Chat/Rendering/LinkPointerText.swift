import AppKit
import SwiftUI

/// Message text whose link runs show the pointing hand, as links do across macOS.
/// `Text` gives a link run no pointer of its own, and `.pointerStyle(.link)` on the
/// whole view would cover the plain words too, so the renderer records where links draw.
/// Selectable text sets the I-beam on every mouse move and beats `.pointerStyle`,
/// so the hover sets the hand itself, after that move.
struct LinkPointerText: View {
  let text: AttributedString
  @State private var linkFrames = LinkFrames()

  var body: some View {
    tagged
      .textRenderer(LinkFrameRecorder(frames: linkFrames))
      .onContinuousHover { phase in
        if case let .active(location) = phase, linkFrames.rects.contains(where: { $0.contains(location) }) {
          NSCursor.pointingHand.set()
        }
      }
  }

  private var tagged: Text {
    text.runs[\.link].reduce(Text(verbatim: "")) { result, run in
      let piece = Text(AttributedString(text[run.1]))
      return Text("\(result)\(run.0 == nil ? piece : piece.customAttribute(LinkRun()))")
    }
  }
}

private struct LinkRun: TextAttribute {}

/// Written while the text draws, read on hover once that layout is on screen.
private final nonisolated class LinkFrames: @unchecked Sendable {
  var rects: [CGRect] = []
}

private struct LinkFrameRecorder: TextRenderer {
  let frames: LinkFrames

  func draw(layout: Text.Layout, in ctx: inout GraphicsContext) {
    var rects: [CGRect] = []
    for line in layout {
      for run in line {
        if run[LinkRun.self] != nil {
          rects.append(run.typographicBounds.rect)
        }
        ctx.draw(run)
      }
    }
    frames.rects = rects
  }
}

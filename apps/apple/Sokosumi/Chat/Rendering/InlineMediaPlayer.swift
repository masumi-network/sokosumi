import AVKit
import SwiftUI

/// The Mac's inline player. SwiftUI's `VideoPlayer` aborts in the Debug test host while it builds its type metadata
/// (`_AVKit_SwiftUI`, `getSuperclassMetadata`), so result outputs and message attachments host `AVPlayerView`.
struct InlineMediaPlayer: NSViewRepresentable {
  let player: AVPlayer

  func makeNSView(context _: Context) -> AVPlayerView {
    let view = AVPlayerView()
    view.controlsStyle = .inline
    view.player = player
    return view
  }

  func updateNSView(_ view: AVPlayerView, context _: Context) {
    if view.player !== player {
      view.player = player
    }
  }

  static func dismantleNSView(_ view: AVPlayerView, coordinator _: ()) {
    view.player?.pause()
  }
}

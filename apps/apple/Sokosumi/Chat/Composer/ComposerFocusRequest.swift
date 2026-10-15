#if os(macOS)
  import AppKit
  import SwiftUI

  /// The window's ask that a room's composer take focus when it opens. A room clicked in the sidebar opens ready to
  /// type, as web's room composer focuses on mount (`rooms-client.tsx` `focusOnMount`); one reached with the arrow keys
  /// leaves focus on the list, so the next key keeps moving through it.
  @MainActor @Observable final class ComposerFocusRequest {
    private var roomId: String?

    /// Called from the sidebar's selection setter, while the event that changed the selection is still current.
    func roomPicked(_ roomId: String, by event: NSEvent?) {
      switch event?.type {
      case .leftMouseDown, .leftMouseUp: self.roomId = roomId
      default: self.roomId = nil
      }
    }

    /// Whether this room's composer should take focus now. The first room composer to ask ends the request, so a
    /// pick another room's opening overtook can never take focus later.
    func take(_ roomId: String) -> Bool {
      defer { self.roomId = nil }
      return self.roomId == roomId
    }
  }

  extension EnvironmentValues {
    @Entry var composerFocusRequest: ComposerFocusRequest?
  }
#endif

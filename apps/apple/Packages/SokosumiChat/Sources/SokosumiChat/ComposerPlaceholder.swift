import CoreAPI

/// The empty composer's prompt: web's `Thread.replyPlaceholder` in a Thread, `directComposerPlaceholder` in a Direct
/// and `composerPlaceholderWithChannel` in any other room (`rooms-client.tsx`, `thread-panel.tsx`).
public func composerPlaceholder(room: Components.Schemas.ChatRoom?, currentUserId: String, inThread: Bool) -> String {
  if inThread {
    return "Reply in thread"
  }
  guard let room else { return "Message" }
  let name = roomDisplayName(room, currentUserId: currentUserId)
  return room.kind == .direct ? "Message \(name)" : "Message #\(name)"
}

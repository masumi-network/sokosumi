import Ably
import Foundation

extension ARTRealtime: GatedChannelHost {
  var canAuthorize: Bool {
    let state = connection.state
    return state != .closing && state != .closed && state != .failed
  }

  /// Token renewal emits `update` while still connected, so only `connected` is heard.
  func onConnected(_ handler: @escaping @Sendable () -> Void) -> AnyObject? {
    connection.on(.connected) { _ in handler() }
  }

  func removeListener(_ listener: AnyObject) {
    if let listener = listener as? ARTEventListener {
      connection.off(listener)
    }
  }

  func authorize(_ completion: @escaping @Sendable (_ capability: String?, _ failed: Bool) -> Void) {
    auth.authorize { token, error in
      completion(token?.capability, error != nil)
    }
  }
}

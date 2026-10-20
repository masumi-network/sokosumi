#if os(macOS)
  import CoreAPI
  import Foundation
  @testable import Sokosumi
  import SokosumiAuth
  import SokosumiWorkspace

  extension WorkspaceState {
    /// A workspace on its own signed-out session, for view tests that never sign in. A test that checks sign-out
    /// passes its `AuthState` to `init(auth:)` instead.
    convenience init(clientProvider: @escaping (AuthState) -> Client? = { _ in nil }, now: @escaping () -> Date = Date.init) {
      self.init(auth: AuthState(), clientProvider: clientProvider, now: now)
    }
  }
#endif

#if os(macOS)
  import Foundation
  import SwiftUI

  /// The clock a jump mark's hold runs on in the view: how far it has drawn and when it is gone. `JumpMark` itself
  /// reads no clock. A mark lands on its `TranscriptSession`'s clock, room and Thread alike, so a test passes the same
  /// clock it advances to both, and a slow runner cannot outlive the hold.
  protocol JumpMarkClock: Sendable {
    @MainActor var now: Date { get }
    @MainActor func sleep(until deadline: Date) async throws
  }

  struct SystemJumpMarkClock: JumpMarkClock {
    @MainActor var now: Date {
      Date()
    }

    @MainActor func sleep(until deadline: Date) async throws {
      try await Task.sleep(for: .seconds(max(0, deadline.timeIntervalSinceNow)))
    }
  }

  extension EnvironmentValues {
    @Entry var jumpMarkClock: any JumpMarkClock = SystemJumpMarkClock()
  }
#endif

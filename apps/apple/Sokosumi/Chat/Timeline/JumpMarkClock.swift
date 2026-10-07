#if os(macOS)
  import Foundation
  import SwiftUI

  /// The clock a room's jump mark runs on: when it lands, how far its hold has drawn and when it is gone.
  /// `JumpMark` itself reads no clock. Tests pass one they advance, so a slow runner cannot outlive the hold.
  /// The Thread's own mark lands on `ThreadSession`'s clock and waits out its hold on this one, so a test passes the
  /// same clock to both.
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

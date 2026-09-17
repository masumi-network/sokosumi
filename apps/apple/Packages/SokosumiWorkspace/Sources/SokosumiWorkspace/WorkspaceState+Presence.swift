import CoreAPI
import Foundation
import SokosumiChat
import SokosumiRealtime

/// Org presence lifecycle (ADR 0003, web `OrgPresenceProvider`): publish on
/// the active organization while the socket lives, mirror teammates, and
/// leave on switch, sign-out and termination. Coworkers and Soko Bots stay
/// always-online, so only humans consult the live map.
public extension WorkspaceState {
  /// Live teammate presence with the room DTO value as fallback, like web's
  /// `LiveMemberPresenceDot`: personal workspaces and members without a
  /// socket entry show what Core last reported.
  func presence(for profile: ChatParticipantProfile) -> Components.Schemas.ChatRoomPresence {
    switch profile.recipient {
    case let .human(userId):
      presence.presence(forUser: userId, fallback: Components.Schemas.ChatRoomPresence(rawValue: profile.presence) ?? .offline)
    case .coworker, .sokoBot:
      .online
    }
  }

  func presence(forUser userId: String, fallback: Components.Schemas.ChatRoomPresence) -> Components.Schemas.ChatRoomPresence {
    presence.presence(forUser: userId, fallback: fallback)
  }

  /// Pointer, key or scroll input: refreshes `lastActiveAt` on the shared
  /// throttle. Called from the platform adapter for every event, so it must
  /// stay cheap and publish nothing while idle presence is unchanged.
  func recordPresenceActivity() {
    presence.recordActivity()
    publishPresence(force: false)
  }

  /// App termination: leave presence and close the socket before the
  /// process exits, so teammates see this device go offline at once instead
  /// of after Ably's disconnect grace.
  func prepareForTermination() {
    stopRealtime()
  }
}

extension WorkspaceState {
  /// Selection changed or the socket (re)started: enter the active
  /// organization's channel, leaving any previous one.
  func syncPresenceOrganization() {
    let organizationId = selection?.workspace.organizationId
    guard presence.organizationId != organizationId else { return }
    presence.setOrganization(organizationId)
    realtime?.setPresenceOrganization(organizationId)
    publishPresence(force: true)
  }

  func publishPresence(force: Bool) {
    guard let realtime, let data = presence.publication(force: force) else { return }
    realtime.publishPresence(data)
  }

  func applyPresenceRoster(organizationId: String, members: [ChatPresenceMember]) {
    presence.replaceRoster(organizationId: organizationId, members: members)
  }

  /// The self dot reads offline only after the socket was up once.
  func applyPresenceReachability(healthy: Bool) {
    if healthy {
      realtimeEverConnected = true
    }
    presence.setReachable(!realtimeEverConnected || healthy)
  }

  /// Web reclassifies teammates every 30 s and rechecks its own idle state on
  /// the same cadence; the recheck publishes only when the payload changed.
  func startPresenceTick() {
    presenceTickTask?.cancel()
    presenceTickTask = Task { [weak self] in
      while !Task.isCancelled {
        do { try await Task.sleep(for: .seconds(30)) } catch { return }
        guard let self else { return }
        presence.reclassify()
        publishPresence(force: false)
      }
    }
  }

  func stopPresence() {
    presenceTickTask?.cancel()
    presenceTickTask = nil
    realtimeEverConnected = false
    presence.reset()
  }
}

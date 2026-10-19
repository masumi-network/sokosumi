import CoreAPI
@testable import SokosumiChat
import Testing

/// AI/human Direct avatar presence (ADR 0003 v1): one rule both sidebar views used to compute separately.
struct DirectRoomPresenceTests {
  @Test func aiStaysOnlineRegardlessOfLiveMap() {
    let peer = DirectRoomAvatarParticipant(id: "bot", name: "Soko", imageURL: nil, isAI: true, presence: .offline)
    #expect(peer.resolvedPresence(live: [:]) == .online)
    #expect(peer.resolvedPresence(live: ["bot": .offline]) == .online)
    #expect(peer.resolvedPresence(live: ["bot": .afk]) == .online)
  }

  @Test func humanOverlaysLivePresenceOnTheSnapshot() {
    let peer = DirectRoomAvatarParticipant(id: "ada", name: "Ada", imageURL: nil, presence: .offline)
    #expect(peer.resolvedPresence(live: [:]) == .offline)
    #expect(peer.resolvedPresence(live: ["ada": .online]) == .online)
    #expect(peer.resolvedPresence(live: ["ada": .afk]) == .afk)
    #expect(peer.resolvedPresence(live: ["other": .online]) == .offline)
  }

  @Test func liveMapWinsOverAnOnlineSnapshot() {
    let peer = DirectRoomAvatarParticipant(id: "ada", name: "Ada", imageURL: nil, presence: .online)
    #expect(peer.resolvedPresence(live: ["ada": .afk]) == .afk)
    #expect(peer.resolvedPresence(live: [:]) == .online)
  }
}

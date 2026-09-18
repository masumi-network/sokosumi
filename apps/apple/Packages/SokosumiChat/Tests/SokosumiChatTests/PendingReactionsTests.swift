import CoreAPI
import SokosumiChat
import Testing

private typealias Reaction = Components.Schemas.ChatRoomMessageReaction

private let ada = PendingReactionViewer(id: "user-1", name: "Ada")
private let bobThumbs = Reaction(emoji: "👍", count: 1, reactedByCurrentUser: false, reactors: [.init(id: "user-2", name: "Bob")])

private func message(_ id: String = "m1", _ reactions: [Reaction] = []) -> Components.Schemas.ChatRoomMessage {
  var message = chatRoomMessage(from: .init(clientTurnId: id, roomId: "room", content: "Hello",
                                            sender: .init(id: "user-2", name: "Bob", email: "bob@example.com", presence: .online)))
  message.id = id
  message.reactions = reactions
  return message
}

private func pending(_ emoji: String, _ reacted: Bool, on messageId: String = "m1") -> PendingReaction {
  .init(messageId: messageId, emoji: emoji, reacted: reacted)
}

struct PendingReactionsTests {
  @Test func addsNewEntryWithViewerAsOnlyReactor() {
    let shown = applyingPendingReaction(pending("👍", true), to: message(), viewer: ada)
    #expect(shown.reactions == [.init(emoji: "👍", count: 1, reactedByCurrentUser: true, reactors: [.init(id: "user-1", name: "Ada")])])
  }

  @Test func joinsExistingEntryAtEndOfReactorList() {
    let shown = applyingPendingReaction(pending("👍", true), to: message("m1", [bobThumbs]), viewer: ada)
    #expect(shown.reactions.first?.count == 2)
    #expect(shown.reactions.first?.reactedByCurrentUser == true)
    #expect(shown.reactions.first?.reactors.map(\.name) == ["Bob", "Ada"])
  }

  @Test func keepsCappedReactorListWhenJoiningCrowdedEntry() {
    let crowd = (0 ..< maxListedReactionReactors).map { Components.Schemas.ChatRoomMessageReactor(id: "u\($0)", name: "User \($0)") }
    let crowded = Reaction(emoji: "👍", count: 31, reactedByCurrentUser: false, reactors: crowd)
    let shown = applyingPendingReaction(pending("👍", true), to: message("m1", [crowded]), viewer: ada)
    #expect(shown.reactions.first?.count == 32)
    #expect(shown.reactions.first?.reactors == crowd)
  }

  @Test func returnsSameMessageWhenIntentAlreadyHolds() {
    let mine = Reaction(emoji: "👍", count: 1, reactedByCurrentUser: true, reactors: [.init(id: "user-1", name: "Ada")])
    for (intent, confirmed) in [(true, message("m1", [mine])), (false, message("m1", [bobThumbs])), (false, message())] {
      #expect(applyingPendingReaction(pending("👍", intent), to: confirmed, viewer: ada) == confirmed)
    }
  }

  @Test func removesViewerAndDropsEntryThatReachesZero() {
    let mine = Reaction(emoji: "👍", count: 1, reactedByCurrentUser: true, reactors: [.init(id: "user-1", name: "Ada")])
    let heart = Reaction(emoji: "❤️", count: 1, reactedByCurrentUser: false, reactors: [])
    let shown = applyingPendingReaction(pending("👍", false), to: message("m1", [mine, heart]), viewer: ada)
    #expect(shown.reactions == [heart])
  }

  @Test func removesViewerFromSharedEntryEvenBeyondListedReactors() {
    var shared = bobThumbs
    shared.count = 2
    shared.reactedByCurrentUser = true
    shared.reactors.append(.init(id: "user-1", name: "Ada"))
    #expect(applyingPendingReaction(pending("👍", false), to: message("m1", [shared]), viewer: ada).reactions == [bobThumbs])
    var unlisted = bobThumbs
    unlisted.count = 25
    unlisted.reactedByCurrentUser = true
    let shown = applyingPendingReaction(pending("👍", false), to: message("m1", [unlisted]), viewer: ada)
    #expect(shown.reactions.first?.count == 24)
    #expect(shown.reactions.first?.reactedByCurrentUser == false)
    #expect(shown.reactions.first?.reactors.map(\.name) == ["Bob"])
  }

  @Test func unknownViewerUpdatesCountAndHighlightWithoutName() {
    let shown = applyingPendingReaction(pending("👍", true), to: message("m1", [bobThumbs]), viewer: .init(id: "user-1", name: nil))
    #expect(shown.reactions.first?.count == 2)
    #expect(shown.reactions.first?.reactedByCurrentUser == true)
    #expect(shown.reactions.first?.reactors.map(\.name) == ["Bob"])
  }

  @Test func overlayAppliesOnlyThisMessagesIntentsInTapOrder() {
    var reactions = PendingReactions()
    let untouched = message("m3")
    #expect(reactions.overlaying([untouched], viewer: ada) == [untouched])
    #expect(reactions.tap(messageId: "m1", emoji: "🎉", confirmedReacted: false) == true)
    #expect(reactions.tap(messageId: "m1", emoji: "👍", confirmedReacted: false) == true)
    #expect(reactions.tap(messageId: "m2", emoji: "❤️", confirmedReacted: false) == true)
    let shown = reactions.overlaying([message("m1", [bobThumbs]), untouched], viewer: ada)
    #expect(shown[0].reactions.map(\.emoji) == ["👍", "🎉"])
    #expect(shown[0].reactions.map(\.count) == [2, 1])
    #expect(shown[1] == untouched)
  }

  @Test func lastTapWinsWhileOneRequestRuns() {
    var reactions = PendingReactions()
    // On, off, on: one request, and the server already has "on" when it returns.
    #expect(reactions.tap(messageId: "m1", emoji: "👍", confirmedReacted: false) == true)
    #expect(reactions.tap(messageId: "m1", emoji: "👍", confirmedReacted: false) == nil)
    #expect(reactions.intent(messageId: "m1", emoji: "👍") == false)
    #expect(reactions.overlaying(message(), viewer: ada).reactions.isEmpty)
    #expect(reactions.intent(messageId: "m1", emoji: "👍", after: true) == false)
    #expect(reactions.tap(messageId: "m1", emoji: "👍", confirmedReacted: false) == nil)
    #expect(reactions.intent(messageId: "m1", emoji: "👍", after: true) == nil)
    // Another emoji on the same message has its own request.
    #expect(reactions.tap(messageId: "m1", emoji: "❤️", confirmedReacted: true) == false)
    reactions.settle(messageId: "m1", emoji: "👍")
    #expect(reactions.intents == [pending("❤️", false)])
    #expect(reactions.intent(messageId: "m1", emoji: "👍", after: true) == nil)
  }

  @Test func intentStaysOnTopOfReplacedConfirmedReactions() {
    var reactions = PendingReactions()
    _ = reactions.tap(messageId: "m1", emoji: "👍", confirmedReacted: false)
    let heart = Reaction(emoji: "❤️", count: 1, reactedByCurrentUser: false, reactors: [.init(id: "user-2", name: "Bob")])
    // A realtime patch replaced the confirmed list; the intent is applied again on top.
    let shown = reactions.overlaying(message("m1", [heart]), viewer: ada)
    #expect(shown.reactions.map(\.emoji) == ["❤️", "👍"])
    #expect(shown.reactions.last?.reactedByCurrentUser == true)
    // Failure drops only this emoji's intent: the confirmed row shows again.
    reactions.settle(messageId: "m1", emoji: "👍")
    #expect(reactions.overlaying(message("m1", [heart]), viewer: ada).reactions == [heart])
  }
}

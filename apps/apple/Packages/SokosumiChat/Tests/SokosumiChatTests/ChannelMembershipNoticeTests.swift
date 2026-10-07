import SokosumiChat
import Testing

struct ChannelMembershipNoticeTests {
  /// Web toasts every removal; only the agents, removed without a confirm, get Undo and stay until closed.
  @Test func onlyAnAgentRemovalOffersUndo() {
    let person = ChannelMembershipNotice.removed(.human("gia"), name: "Gia Guest")
    #expect(person.message == "Removed Gia Guest from the channel.")
    #expect(person.undo == nil && !person.staysUntilClosed)
    let coworker = ChannelMembershipNotice.removed(.coworker("elena"), name: "Elena")
    #expect(coworker.undo == .coworker("elena") && coworker.staysUntilClosed)
    let sokoBot = ChannelMembershipNotice.removed(.sokoBot("bot"), name: "Ava Bot")
    #expect(sokoBot.message == "Removed Ava Bot from the channel.")
    #expect(sokoBot.undo == .sokoBot("bot") && sokoBot.staysUntilClosed)
  }

  @Test func addedCountsTheSelection() {
    #expect(ChannelMembershipNotice.added(count: 1).message == "Added 1 member.")
    #expect(ChannelMembershipNotice.added(count: 3).message == "Added 3 members.")
    #expect(!ChannelMembershipNotice.added(count: 3).staysUntilClosed)
  }
}

import Foundation
@testable import SokosumiChat
import Testing

@MainActor
struct ChannelCreationTests {
  private let roster = ChatRecipientRoster(targets: [
    .init(id: .human("me"), name: "Me"), .init(id: .human("peer"), name: "Peer"),
    .init(id: .coworker("agent"), name: "Agent"), .init(id: .sokoBot("bot"), name: "Assistant")
  ])

  @Test func draftMatchesWebSlugAndNameRules() {
    var draft = ChannelDraft()
    draft.setSlug(" #Téam  Soko.-")
    #expect(draft.slug == "team-soko-")
    #expect(draft.canonicalSlug == "team-soko")
    #expect(draft.name == "Team Soko")
    draft.setName("##Custom Name")
    draft.setSlug("other")
    #expect(draft.name == "Custom Name")
    draft.setTopic(String(repeating: "x", count: 210))
    #expect(draft.topic.count == 200)
    draft.setName(String(repeating: "👩🏽", count: 80))
    #expect(draft.name.utf16.count <= 80)
    draft.setName("  ")
    #expect(!draft.isValid)
  }

  /// Web's counters are `MAX - value.length` (UTF-16 units, as Core's `max(80)` / `max(200)` count) and reach 0, never below.
  @Test func remainingCharactersCountLikeWebAndCore() {
    var draft = ChannelDraft()
    #expect(ChannelDraft.nameLimit == 80 && ChannelDraft.topicLimit == 200 && ChannelDraft.slugLimit == 80)
    #expect(draft.remainingNameCharacters == 80)
    #expect(draft.remainingTopicCharacters == 200)
    draft.setSlug("launch")
    #expect(draft.remainingNameCharacters == 80 - "Launch".count)
    draft.setName("Café 👩🏽")
    #expect(draft.remainingNameCharacters == 80 - "Café 👩🏽".utf16.count)
    draft.setTopic(String(repeating: "t", count: 195))
    #expect(draft.remainingTopicCharacters == 5)
    draft.setName(String(repeating: "n", count: 95))
    #expect(draft.name.utf16.count == 80)
    #expect(draft.remainingNameCharacters == 0)
    draft.setTopic(String(repeating: "t", count: 250))
    #expect(draft.remainingTopicCharacters == 0)
    draft.setSlug(String(repeating: "s", count: 90))
    #expect(draft.slug.count == ChannelDraft.slugLimit)
  }

  /// Web's one status line under the handle: an error replaces the help, checking replaces it, otherwise the help shows.
  @Test func handleStatusFollowsWebsSingleLine() async {
    let model = ChannelCreation()
    #expect(model.handleStatus == .help)
    model.draft.setSlug("...")
    #expect(model.draft.slug.isEmpty)
    await model.checkSlug { _ in
      Issue.record("An empty handle is never checked")
      return true
    }
    #expect(model.handleStatus == .invalid)
    model.draft.setSlug("team")
    await model.checkSlug { _ in
      #expect(model.handleStatus == .checking)
      return true
    }
    #expect(model.handleStatus == .help)
    await model.checkSlug { _ in false }
    #expect(model.handleStatus == .taken)
    await model.checkSlug { _ in throw URLError(.timedOut) }
    #expect(model.handleStatus == .failed)
    let errors = [ChannelCreation.HandleStatus.help, .checking, .invalid, .taken, .failed].filter(\.isError)
    #expect(errors == [.invalid, .taken, .failed])
  }

  /// Web's "Add all {count} members of {organization}" counts every organization member, the creator included, and nothing else.
  @Test func organizationMemberCountIsEveryHumanInTheRoster() {
    #expect(ChannelRoster(recipients: roster, isOwnerOrAdmin: false).organizationMemberCount == 2)
    #expect(ChannelRoster(recipients: .init(targets: []), isOwnerOrAdmin: true).organizationMemberCount == 0)
  }

  @Test func allMembersExcludesAIAndSpecificIncludesCreator() {
    var draft = ChannelDraft()
    draft.recipients = [.coworker("agent")]
    #expect(draft.selectedRecipients(roster: roster, currentUserId: "me") == [.human("me"), .human("peer")])
    draft.addAllMembers = false
    draft.recipients = [.human("peer"), .coworker("agent"), .sokoBot("bot"), .human("unavailable")]
    #expect(draft.selectedRecipients(roster: roster, currentUserId: "me") == [.human("me"), .human("peer"), .coworker("agent"), .sokoBot("bot")])
  }

  @Test func availabilityAndRosterGuardAdvance() async {
    let model = ChannelCreation()
    model.draft.setSlug("team")
    await model.checkSlug { _ in true }
    #expect(!model.canAdvance)
    await model.load { .init(recipients: roster, isOwnerOrAdmin: false) }
    #expect(model.canAdvance)
    model.draft.setSlug("different")
    #expect(!model.canAdvance)
    await model.checkSlug { _ in false }
    #expect(model.availability == .taken)
    #expect(!model.canAdvance)
    await model.checkSlug { _ in true }
    await model.load { .init(recipients: .init(targets: [], membersLoadFailed: true), isOwnerOrAdmin: false) }
    #expect(!model.canAdvance)
    model.advance()
    #expect(model.step == .details)
  }

  @Test func staleAvailabilityCannotAuthorizeNewSlug() async {
    let model = ChannelCreation()
    model.draft.setSlug("old")
    await model.checkSlug { _ in
      model.draft.setSlug("new")
      return true
    }
    #expect(!model.canAdvance)
    #expect(model.availability != .free)
  }

  @Test func transportFailuresUseExistingNetworkMessages() async {
    let model = ChannelCreation()
    await model.load { throw URLError(.notConnectedToInternet) }
    #expect(model.errorMessage == "No network connection. Check your connection and try again.")
    await model.load { .init(recipients: roster, isOwnerOrAdmin: false) }
    model.draft.setSlug("team")
    await model.checkSlug { _ in true }
    model.advance()
    #expect(await model.create { _, _ in throw URLError(.timedOut) } == false)
    #expect(model.errorMessage == "The request timed out. Please try again.")
  }

  @Test func creationFailurePreservesDraftAndConflictReturnsToDetails() async {
    let model = ChannelCreation()
    await model.load { .init(recipients: roster, isOwnerOrAdmin: false) }
    model.draft.setSlug("team")
    await model.checkSlug { _ in true }
    model.advance()
    let draft = model.draft
    #expect(await model.create { _, _ in throw ChatServiceError.unexpectedResponse("Retry") } == false)
    #expect(model.draft == draft)
    #expect(model.step == .participants)
    #expect(model.errorMessage == "Retry")
    let conflicted = await model.create { _, _ in
      let duplicate = await model.create { _, _ in
        Issue.record("Duplicate submission")
        return true
      }
      #expect(!duplicate)
      throw ChannelCreationError.slugTaken
    }
    #expect(!conflicted)
    #expect(model.step == .details)
    #expect(model.availability == .taken)
    #expect(model.draft == draft)
    #expect(!model.creating)
    model.draft.setSlug("free")
    await model.checkSlug { _ in true }
    model.advance()
    #expect(await model.create { _, _ in true })
  }
}

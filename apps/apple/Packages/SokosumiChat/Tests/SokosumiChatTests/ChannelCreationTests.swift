import SokosumiChat
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
    await model.load { .init(recipients: roster, canCreateExternal: false) }
    #expect(model.canAdvance)
    model.draft.setSlug("different")
    #expect(!model.canAdvance)
    await model.checkSlug { _ in false }
    #expect(model.availability == .taken)
    #expect(!model.canAdvance)
    await model.checkSlug { _ in true }
    await model.load { .init(recipients: .init(targets: [], membersLoadFailed: true), canCreateExternal: false) }
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

  @Test func creationFailurePreservesDraftAndConflictReturnsToDetails() async {
    let model = ChannelCreation()
    await model.load { .init(recipients: roster, canCreateExternal: false) }
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

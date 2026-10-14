import CoreAPI
import Foundation
import OpenAPIRuntime
@testable import SokosumiChat
import Testing

/// One row's rules, as the room and the Thread derive them: what it offers, in what menu order, and what it draws.
struct MessageRowTests {
  typealias Message = Components.Schemas.ChatRoomMessage

  private static let created = Date(timeIntervalSince1970: 1_790_000_000)

  private static func message(id: String = "message_1", from sender: String = "ada", content: String = "Release notes are up.",
                              minutes: Double = 0) -> Message {
    var message = chatRoomMessage(from: .init(
      clientTurnId: id, roomId: "room_1", content: content, createdAt: created.addingTimeInterval(minutes * 60),
      sender: .init(id: sender, name: sender.capitalized, email: "\(sender)@example.com", presence: .offline)
    ))
    message.id = id
    message.metadata = nil
    return message
  }

  private static func coworkerShell(_ metadata: [String: any Sendable]) throws -> Message {
    var shell = message(id: "shell", content: "")
    shell.sender = .case2(.init(_type: .coworker, coworker: .init(id: "cow_1", name: "Elena", slug: "elena", caption: nil, image: nil,
                                                                  presence: .online)))
    shell.metadata = try .init(additionalProperties: metadata.mapValues { try OpenAPIValueContainer(unvalidatedValue: $0) })
    return shell
  }

  private static func room(kind: Components.Schemas.ChatRoom.KindPayload = .channel, selfDirect: Bool = false,
                           readOnly: Bool = false) -> Components.Schemas.ChatRoom {
    .init(
      id: "room_1", name: "Room", kind: kind, isSelfDirect: selfDirect, isGroupDirect: false, isReadOnly: readOnly,
      createdByUserId: "ada", createdAt: created, updatedAt: created, unreadCount: 0, unreadMentionCount: 0,
      markedUnread: false, myAccess: .init(value1: .member, value2: "member"),
      userMembers: [], formerUserMembers: [], coworkerMembers: [], sokoBotMembers: []
    )
  }

  /// The room transcript of a channel (pins and Threads) read by Ada.
  private static let channel = TranscriptContext(room: room(), viewerId: "ada", allowsPins: true, allowsThreads: true)
  /// A Direct: Threads, no pins.
  private static let direct = TranscriptContext(room: room(kind: .direct), viewerId: "ada", allowsPins: false, allowsThreads: true)
  /// A Thread's parent and replies: neither pins nor Threads.
  private static let thread = TranscriptContext(room: room(), viewerId: "ada", allowsPins: false, allowsThreads: false)

  private static func row(_ message: Message = message(), in context: TranscriptContext = channel, previous: Message? = nil,
                          isNewest: Bool = false) -> MessageRow {
    MessageRow(message, in: context, previous: previous, isNewest: isNewest)
  }

  // MARK: Menu order (M7)

  @Test func ownChannelMessage() {
    let actions = Self.row().actions
    #expect(actions.menuSections(hasSelection: false, isPinned: false) == [
      [.addReaction, .edit, .quote, .reply],
      [.pin, .copyLink, .sendToSelf],
      [.delete]
    ])
    #expect(actions.menuSections(hasSelection: false, isPinned: true)[1] == [.unpin, .copyLink, .sendToSelf])
  }

  @Test func othersChannelMessage() {
    #expect(Self.row(Self.message(from: "ben")).actions.menuSections(hasSelection: false, isPinned: false) == [
      [.addReaction, .quote, .reply],
      [.pin, .copyLink, .sendToSelf]
    ])
  }

  /// Directs have no message pins (web `showPinButton={!isDirectRoom}`).
  @Test func ownMessageInADirect() {
    #expect(Self.row(in: Self.direct).actions.menuSections(hasSelection: false, isPinned: false) == [
      [.addReaction, .edit, .quote, .reply],
      [.copyLink, .sendToSelf],
      [.delete]
    ])
  }

  /// A Thread offers neither Reply nor Pin, for the parent or its replies; web shows no pin in a Thread.
  @Test(arguments: [true, false])
  func threadParentAndReplies(own: Bool) {
    let expected: [[MessageMenuAction]] = own
      ? [[.addReaction, .edit, .quote], [.copyLink, .sendToSelf], [.delete]]
      : [[.addReaction, .quote], [.copyLink, .sendToSelf]]
    let row = Self.row(Self.message(from: own ? "ada" : "ben"), in: Self.thread)
    #expect(row.actions.menuSections(hasSelection: false, isPinned: false) == expected)
    #expect(row.threadReplyBar == nil)
  }

  /// A Thread reply never pins, even in a channel's room transcript.
  @Test func aThreadReplyDoesNotPin() {
    var reply = Self.message()
    reply.parentMessageId = "parent"
    #expect(!Self.row(reply).actions.canPin)
  }

  @Test func aSelectionPutsCopyFirst() {
    let sections = Self.row(Self.message(from: "ben"), in: Self.direct).actions.menuSections(hasSelection: true, isPinned: false)
    #expect(sections == [[.copySelection], [.addReaction, .quote, .reply], [.copyLink, .sendToSelf]])
    #expect(MessageActions().menuSections(hasSelection: true, isPinned: false) == [[.copySelection]])
    #expect(MessageActions().menuSections(hasSelection: false, isPinned: false).isEmpty)
  }

  /// Row 38b: a Soko Bot reply's thumbs lead its menu as they lead web's hover pill; a selection's Copy stays first.
  @Test func aSokoBotReplyLeadsWithItsThumbs() throws {
    var reply = Self.message(from: "soko")
    reply.metadata = try .init(additionalProperties: ["soko_bot": OpenAPIValueContainer(unvalidatedValue: ["turn_id": "turn_1"])])
    let actions = Self.row(reply, in: Self.direct).actions
    #expect(actions.menuSections(hasSelection: false, isPinned: false) == [
      [.useful, .notUseful],
      [.addReaction, .quote, .reply],
      [.copyLink, .sendToSelf]
    ])
    #expect(actions.menuSections(hasSelection: true, isPinned: false).prefix(2) == [[.copySelection], [.useful, .notUseful]])
  }

  /// A deleted Thread root keeps its tombstone row and its Thread bar; the actions that need a live message leave.
  @Test func aDeletedRootKeepsOnlyItsThreadBar() {
    var root = Self.message()
    root.deletedAt = Self.created
    root.threadReplyCount = 2
    let row = Self.row(root)
    #expect(row.kind == .deleted)
    #expect(row.actions.isEmpty)
    #expect(!row.showsActionBar)
    #expect(row.threadReplyBar != nil)
  }

  // MARK: Kinds

  @Test func kindsComeFromTheRowItself() async throws {
    #expect(MessageKind(Self.message()) == .confirmed)
    var deleted = Self.message()
    deleted.deletedAt = Self.created
    #expect(MessageKind(deleted) == .deleted)
    #expect(MessageKind(Self.message(id: "stream:turn")) == .streaming)
    let joined = try #require(try await fetchTestMessages([testMessageJSON(
      id: "joined", content: "", sender: testUserSender(name: "Ada", email: "ada@example.com"),
      membership: #"{"action":"joined","subject":{"type":"user","id":"user_2","name":"Ada"}}"#
    )]).first)
    #expect(MessageKind(joined) == .statusRow)
    let shell = OutboundShell(clientTurnId: "turn", roomId: "room_1", content: "Hi", createdAt: Self.created,
                              sender: .init(id: "ada", name: "Ada", email: "ada@example.com", presence: .offline))
    #expect(MessageKind(chatRoomMessage(from: shell), outbound: shell) == .pending)
    var failed = shell
    failed.status = .failed
    #expect(MessageKind(chatRoomMessage(from: failed), outbound: failed) == .failed)
  }

  /// A send Core has not confirmed offers nothing and draws only its body; a failed one gives up the Seen by corner.
  @Test(arguments: [OutboundDeliveryStatus.pending, .failed])
  func anOutboundSendOffersNothing(status: OutboundDeliveryStatus) {
    let shell = OutboundShell(clientTurnId: "turn", roomId: "room_1", content: "Notes\n\n[notes.pdf](https://example.com/notes.pdf)",
                              createdAt: Self.created, status: status,
                              sender: .init(id: "ada", name: "Ada", email: "ada@example.com", presence: .offline))
    var context = Self.channel
    context.outbound = [shell]
    let row = Self.row(chatRoomMessage(from: shell), in: context, isNewest: true)
    #expect(row.kind == (status == .pending ? .pending : .failed))
    #expect(row.actions.isEmpty)
    #expect(!row.showsActionBar)
    #expect(row.threadReplyBar == nil)
    #expect(row.keepsSeenByCornerClear == (status == .pending))
  }

  /// A coworker stream's rows are not stored yet: no actions, no Thread.
  @Test func aStreamOverlayOffersNothing() {
    var overlay = Self.message(id: "stream:turn")
    overlay.threadReplyCount = 1
    let row = Self.row(overlay)
    #expect(row.kind == .streaming)
    #expect(row.actions.isEmpty)
    #expect(row.threadReplyBar == nil)
  }

  // MARK: Rooms

  /// Web `useReadOnlyDirectNotice`: Core refuses new messages, Reactions and Quotes; one's own edit and delete stay, and
  /// only a Thread that already has replies opens.
  @Test func aReadOnlyDirectKeepsEditAndDeleteOnly() {
    let readOnly = TranscriptContext(room: Self.room(kind: .direct, readOnly: true), viewerId: "ada", allowsPins: false,
                                     allowsThreads: true)
    #expect(readOnly.isReadOnlyDirect)
    let actions = Self.row(in: readOnly).actions
    #expect(!actions.canReact && !actions.canQuote && !actions.canReply)
    #expect(actions.canEdit && actions.canDelete && actions.canCopyLink && actions.canSendToSelf)
    var answered = Self.message()
    answered.threadReplyCount = 1
    #expect(Self.row(answered, in: readOnly).actions.canReply)
    #expect(Self.row(answered, in: readOnly).threadReplyBar != nil)
  }

  /// Row 27c: the Self Direct does not send its own messages to itself.
  @Test func theSelfDirectSendsNothingToYourself() {
    let notes = TranscriptContext(room: Self.room(kind: .direct, selfDirect: true), viewerId: "ada", allowsPins: false,
                                  allowsThreads: true)
    let actions = Self.row(in: notes).actions
    #expect(!actions.canSendToSelf)
    #expect(actions.canQuote && actions.canEdit)
  }

  @Test func withoutAReaderNothingIsOwn() {
    let anonymous = TranscriptContext(room: Self.room(), viewerId: "", allowsPins: true, allowsThreads: true)
    let actions = Self.row(Self.message(from: ""), in: anonymous).actions
    #expect(!actions.canEdit && !actions.canDelete)
  }

  // MARK: Mention shells

  /// A thinking shell has no actions (web `showActions`) and no link; a failed one keeps Quote, Reactions and its link.
  @Test func aThinkingShellOffersNothingAndAFailedOneKeepsQuote() throws {
    let thinking = try Self.row(Self.coworkerShell(["streaming": true, "mention_id": "mention_1"]))
    #expect(thinking.mentionShell?.isThinking == true)
    #expect(thinking.actions.isEmpty)
    #expect(!thinking.showsActionBar)
    #expect(thinking.threadReplyBar == nil)
    let failed = try Self.row(Self.coworkerShell(["mention_id": "mention_1", "mention_failed": true]))
    #expect(failed.actions.canQuote && failed.actions.canReact && failed.actions.canCopyLink && failed.actions.canPin)
    #expect(!failed.actions.canReply)
    #expect(failed.showsActionBar)
  }

  // MARK: Body parts

  private static let quote = Components.Schemas.ChatRoomMessageQuote(messageId: "source", authorName: "Ben", snippet: "Hello")

  @Test func aPlainMessageIsItsMarkdown() {
    #expect(Self.row().body == [.markdown])
  }

  /// Send to yourself posts only a quote, so there is no text to draw after it.
  @Test func aQuoteComesBeforeItsText() {
    var quoteOnly = Self.message(content: "")
    quoteOnly.quote = Self.quote
    #expect(Self.row(quoteOnly).body == [.quote])
    var withText = Self.message()
    withText.quote = Self.quote
    #expect(Self.row(withText).body == [.quote, .markdown])
  }

  /// A deleted root keeps only its tombstone: no extras, no Edited mark, no Pinned label, even with a quote and unfurls.
  @Test func aDeletedRootIsOnlyItsTombstone() {
    var root = Self.message()
    root.quote = Self.quote
    root.unfurls = [.init(url: "https://example.com", title: "Example", description: "Preview")]
    root.editedAt = Self.created
    #expect(Self.row(root).unfurls.count == 1)
    #expect(Self.row(root).isEdited)
    root.deletedAt = Self.created
    let row = Self.row(root)
    #expect(row.body == [.deleted])
    #expect(!row.isEdited)
    #expect(row.unfurls.isEmpty)
    #expect(row.resultPreviewIds.isEmpty)
    #expect(row.sokoBotFooter == nil)
    #expect(!row.showsPinnedLabel(isPinned: true))
  }

  @Test func theRowBeingEditedIsItsComposer() throws {
    var reply = Self.message(from: "soko")
    reply.metadata = try .init(additionalProperties: [
      "soko_bot": OpenAPIValueContainer(unvalidatedValue: ["turn_id": "turn_1", "source": "INGEST"])
    ])
    #expect(Self.row(reply).body == [.sokoBotSource(.inbox), .markdown])
    var editing = Self.channel
    editing.editingMessageId = reply.id
    #expect(Self.row(reply, in: editing).body == [.editComposer])
    var quoted = Self.message()
    quoted.quote = Self.quote
    editing.editingMessageId = quoted.id
    #expect(Self.row(quoted, in: editing).body == [.quote, .editComposer])
  }

  @Test func aFailedShellIsItsFailureAndAThinkingOneItsThought() throws {
    let failed = try Self.row(Self.coworkerShell(["mention_id": "mention_1", "mention_failed": true]))
    #expect(failed.body == [.failedMention])
    let thinking = try Self.coworkerShell(["streaming": true, "mention_id": "mention_1"])
    #expect(Self.row(thinking).body == [.thought(startedAt: thinking.createdAt, shellWorking: true)])
    let started = try Self.coworkerShell([
      "streaming": true, "mention_id": "mention_1", "thought_timing_ms": ["start": 1_790_000_100_000]
    ])
    #expect(Self.row(started).body == [.thought(startedAt: Date(timeIntervalSince1970: 1_790_000_100), shellWorking: true)])
  }

  /// A coworker's settled answer keeps its Thought header above the text, with no shell working.
  @Test func aCoworkersAnswerKeepsItsThoughtAboveTheText() throws {
    var answer = try Self.coworkerShell([:])
    answer.content = "Done."
    #expect(Self.row(answer).body == [.thought(startedAt: answer.createdAt, shellWorking: false), .markdown])
  }

  @Test func aProjectReplyIsTheChosenProject() {
    let projectId = "00000000-0000-4000-8000-000000000001"
    let reply = Self.message(content: ProjectSelectionReply.content(projectId: projectId, name: "Apollo"))
    #expect(Self.row(reply).body == [.projectSelection(.init(projectId: projectId, name: "Apollo"))])
  }

  @Test func theSokoBotSourceLabelComesFirst() throws {
    var reply = Self.message(from: "soko")
    reply.quote = Self.quote
    reply.metadata = try .init(additionalProperties: [
      "soko_bot": OpenAPIValueContainer(unvalidatedValue: ["turn_id": "turn_1", "source": "EVENT"])
    ])
    #expect(Self.row(reply).body == [.sokoBotSource(.taskUpdate), .quote, .markdown])
  }

  @Test func editedAndThenDeletedIsNotEdited() {
    var message = Self.message()
    #expect(!Self.row(message).isEdited)
    message.editedAt = Self.created
    #expect(Self.row(message).isEdited)
    message.deletedAt = Self.created
    #expect(!Self.row(message).isEdited)
  }

  @Test func thePinnedLabelNeedsAPinAndALiveMessage() {
    var message = Self.message()
    #expect(Self.row(message).showsPinnedLabel(isPinned: true))
    #expect(!Self.row(message).showsPinnedLabel(isPinned: false))
    message.deletedAt = Self.created
    #expect(!Self.row(message).showsPinnedLabel(isPinned: true))
  }

  // MARK: Busy actions

  @Test func busyActionsFollowTheRunningRequests() {
    #expect(MessageRowActivity().busy.isEmpty)
    #expect(MessageRowActivity(isUpdatingPin: true).busy == [.pin, .unpin])
    #expect(MessageRowActivity(feedbackLocked: true).busy == [.useful, .notUseful])
    #expect(MessageRowActivity(isDeleting: true, isSendingToSelf: true).busy == [.delete, .sendToSelf])
  }

  // MARK: Display parts

  @Test func continuationFollowsTheSenderAndTheBurst() {
    let first = Self.message(id: "first")
    #expect(Self.row(Self.message(id: "second", minutes: 1), previous: first).isContinuation)
    #expect(!Self.row(Self.message(id: "second", from: "ben", minutes: 1), previous: first).isContinuation)
    #expect(!Self.row(Self.message(id: "second", minutes: 6), previous: first).isContinuation)
    #expect(!Self.row(first).isContinuation)
  }

  @Test func theEditedRowDropsItsSkillChips() {
    var message = Self.message()
    message.skills = [.init(id: "a/b/grill", name: "grill", description: nil, url: "https://skills.sh/a/b/grill")]
    #expect(Self.row(message).skills.count == 1)
    var editing = Self.channel
    editing.editingMessageId = message.id
    let row = Self.row(message, in: editing)
    #expect(row.isEditing)
    #expect(row.skills.isEmpty)
  }

  /// Row 31b3: the newest message ending in files keeps the Seen by corner under it, until anything follows the files.
  @Test func theNewestAttachmentRowKeepsTheSeenByCornerClear() {
    let source = "Notes below.\n\n[notes.pdf](https://example.com/notes.pdf)"
    #expect(MessageMarkdown.endsWithAttachmentRun(source))
    let attachment = Self.message(content: source)
    #expect(Self.row(attachment, isNewest: true).keepsSeenByCornerClear)
    #expect(!Self.row(attachment, isNewest: false).keepsSeenByCornerClear)
    #expect(!Self.row(Self.message(), isNewest: true).keepsSeenByCornerClear)
    var reacted = attachment
    reacted.reactions = [.init(emoji: "👍", count: 1, reactedByCurrentUser: true, reactors: [])]
    let reactedRow = Self.row(reacted, isNewest: true)
    #expect(reactedRow.showsReactions)
    #expect(!reactedRow.keepsSeenByCornerClear)
    var answered = attachment
    answered.threadReplyCount = 1
    #expect(!Self.row(answered, isNewest: true).keepsSeenByCornerClear)
    #expect(Self.row(answered, in: Self.thread, isNewest: true).keepsSeenByCornerClear)
  }
}

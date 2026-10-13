import CoreAPI

/// Everything one transcript row decides from its message and the transcript around it: what it offers and which
/// parts it draws. The room and the Thread build one per message; the view only lays it out, and the rules have
/// UI-free tests here. Flags and enums only: the app owns every word and symbol.
public struct MessageRow: Equatable, Sendable {
  public typealias Message = Components.Schemas.ChatRoomMessage

  public let kind: MessageKind
  /// Persisted mention shell (thinking or failed); nil for ordinary rows.
  public let mentionShell: MentionThoughtShell?
  /// Same sender, day and burst as the row above: no avatar, name or clock.
  public let isContinuation: Bool
  public let actions: MessageActions
  /// The hop badge on a message one assistant wrote to another; web shows it in the hover pill.
  public let sokoBotChain: SokoBotChainMetadata?
  /// Web's hover pill and fill: a row not deleted with anything to offer. A thinking shell has no actions (web `showActions`).
  public let showsActionBar: Bool
  /// The inline edit composer stands in for this row's body.
  public let isEditing: Bool
  public let showsReactions: Bool
  /// Link previews, result cards and the Soko Bot footer follow a settled body only.
  public let unfurls: [Components.Schemas.ChatRoomMessageUnfurl]
  /// Web renders the Soko Bot footer only once the turn's answer is in the row, and only with approvals or Tasks.
  public let sokoBotFooter: SokoBotTurnMetadata?
  /// The recorded results a settled row reads (row 38e1, web `ResultPreviews`), with the footer after them.
  public let resultPreviewIds: [String]
  /// Web `MessageSkillChips` under the body (row 42), the pending shell's too; not while the row is edited or
  /// stands in for a coworker's mention.
  public let skills: [Components.Schemas.ChatRoomMessageSkill]
  /// The Thread bar under a room message; nil inside a Thread and where the Thread cannot open.
  public let threadReplyBar: ThreadReplyBar?
  /// Web `keepsSeenByCornerClear` (row 31b3): the newest message's body ends in attachments and nothing is drawn
  /// after it, so the Seen by faces sit under the attachment instead of beside it and the column never narrows.
  public let keepsSeenByCornerClear: Bool

  public init(_ message: Message, in context: TranscriptContext, previous: Message?, isNewest: Bool) {
    let outbound = context.outbound.first { $0.id == message.id }
    let kind = MessageKind(message, outbound: outbound)
    let mentionShell = MentionThoughtShell(message: message)
    let isThinking = mentionShell?.isThinking == true
    let isDeleted = message.deletedAt != nil
    let isEditing = context.editingMessageId == message.id
    let ownsMessage = canModifyOwnMessage(message, userId: context.viewerId)
    // Web hides the Thread button on stream overlays and mention shells (`shouldShowChatRoomThreadButton`).
    let opensThread = context.allowsThreads && canOpenThread(message, takesNewMessages: context.takesNewMessages)
    let actions = MessageActions(
      offersFeedback: SokoBotFeedback.turnId(for: message) != nil,
      canReact: canReactToMessage(message) && context.takesNewMessages,
      canEdit: ownsMessage,
      // Quoting fills the composer, which a Read-only Direct lacks.
      canQuote: canQuoteMessage(message) && context.takesNewMessages,
      canReply: opensThread && !isDeleted,
      canPin: context.allowsPins && message.parentMessageId == nil && canReactToMessage(message),
      // Web `isDurableRoomMessage`: no link while the shell is still thinking.
      canCopyLink: kind == .confirmed && !isThinking,
      canSendToSelf: canQuoteMessage(message) && !context.isSelfDirect,
      canDelete: ownsMessage
    )
    let sokoBotChain = SokoBotChainMetadata(message: message)
    let showsBodyExtras = !kind.isOutbound && mentionShell == nil
    let showsReactions = !isDeleted && !kind.isOutbound && !message.reactions.isEmpty
    let unfurls = showsBodyExtras ? message.unfurls ?? [] : []
    let footer = SokoBotTurnMetadata(message: message).flatMap { showsBodyExtras && $0.hasFooter ? $0 : nil }
    let resultPreviewIds = showsBodyExtras ? MessageResultPreviews.descriptorIds(of: message) : []
    let skills = !isDeleted && mentionShell == nil && !isEditing ? message.skills ?? [] : []
    let threadReplyBar = opensThread ? ThreadReplyBar(message: message) : nil

    self.kind = kind
    self.mentionShell = mentionShell
    isContinuation = isMessageContinuation(previous: previous, current: message)
    self.actions = actions
    self.sokoBotChain = sokoBotChain
    showsActionBar = !isDeleted && !isThinking && (!actions.isEmpty || sokoBotChain != nil)
    self.isEditing = isEditing
    self.showsReactions = showsReactions
    self.unfurls = unfurls
    sokoBotFooter = footer
    self.resultPreviewIds = resultPreviewIds
    self.skills = skills
    self.threadReplyBar = threadReplyBar
    keepsSeenByCornerClear = isNewest && MessageMarkdown.endsWithAttachmentRun(message.content) && !isDeleted
      && mentionShell == nil && !isEditing && !showsReactions && threadReplyBar == nil && skills.isEmpty
      && unfurls.isEmpty && resultPreviewIds.isEmpty && footer == nil && kind != .failed
  }
}

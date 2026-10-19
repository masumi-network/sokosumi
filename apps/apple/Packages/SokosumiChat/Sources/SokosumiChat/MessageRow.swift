import CoreAPI
import Foundation

/// One part of a row's body, in drawing order (web `MessageBody`). Payloads carry only what was parsed; the quote
/// and the Markdown read the message itself.
public enum MessageBodyPart: Equatable, Sendable, Identifiable {
  /// Soko Bot's quiet line above a message it sent on its own.
  case sokoBotSource(SokoBotSourceLabel)
  /// A coworker's mention that failed to dispatch.
  case failedMention
  /// A coworker's Thought; `shellWorking` while a persisted mention shell still waits for its answer.
  case thought(startedAt: Date, shellWorking: Bool)
  /// "This message was deleted": nothing follows it.
  case deleted
  case quote
  /// The inline edit composer stands in for the text.
  case editComposer
  /// A project question's answer, drawn as the chosen project's chip.
  case projectSelection(ProjectSelectionReply)
  case markdown

  /// A body holds each case once, so the case names the part.
  public var id: String {
    switch self {
    case .sokoBotSource: "sokoBotSource"
    case .failedMention: "failedMention"
    case .thought: "thought"
    case .deleted: "deleted"
    case .quote: "quote"
    case .editComposer: "editComposer"
    case .projectSelection: "projectSelection"
    case .markdown: "markdown"
    }
  }
}

/// Everything one transcript row decides from its message and the transcript around it: what it offers and which
/// parts it draws. The room and the Thread build one per message; the view only lays it out, and the rules have
/// UI-free tests here. Flags and enums only: the app owns every word and symbol.
public struct MessageRow: Equatable, Sendable {
  public typealias Message = Components.Schemas.ChatRoomMessage

  public let kind: MessageKind
  /// Same sender, day and burst as the row above: no avatar, name or clock.
  public let isContinuation: Bool
  public let actions: MessageActions
  /// The hop badge on a message one assistant wrote to another; web shows it in the hover pill.
  public let sokoBotChain: SokoBotChainMetadata?
  /// Web's hover pill and fill: a row not deleted with anything to offer. A thinking shell has no actions (web `showActions`).
  public let showsActionBar: Bool
  /// What the row draws above its extras, in order.
  public let body: [MessageBodyPart]
  /// Web's "Edited" mark: edited and still there.
  public let isEdited: Bool
  private let isDeleted: Bool
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
    let showsBodyExtras = !isDeleted && !kind.isOutbound && mentionShell == nil
    let showsReactions = !isDeleted && !kind.isOutbound && !message.reactions.isEmpty
    let unfurls = showsBodyExtras ? message.unfurls ?? [] : []
    let footer = SokoBotTurnMetadata(message: message).flatMap { showsBodyExtras && $0.hasFooter ? $0 : nil }
    let resultPreviewIds = showsBodyExtras ? MessageResultPreviews.descriptorIds(of: message) : []
    let skills = !isDeleted && mentionShell == nil && !isEditing ? message.skills ?? [] : []
    let threadReplyBar = opensThread ? ThreadReplyBar(message: message) : nil

    self.kind = kind
    isContinuation = isMessageContinuation(previous: previous, current: message)
    self.actions = actions
    self.sokoBotChain = sokoBotChain
    showsActionBar = !isDeleted && !isThinking && (!actions.isEmpty || sokoBotChain != nil)
    body = Self.bodyParts(of: message, shell: mentionShell, isEditing: isEditing, isDeleted: isDeleted)
    isEdited = message.editedAt != nil && !isDeleted
    self.isDeleted = isDeleted
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

  /// Whether the "Pinned" label shows: a deleted message is not pinned. Where it sits (header or gutter) is the view's.
  public func showsPinnedLabel(isPinned: Bool) -> Bool {
    isPinned && !isDeleted
  }

  private static func bodyParts(of message: Message, shell: MentionThoughtShell?, isEditing: Bool, isDeleted: Bool) -> [MessageBodyPart] {
    var parts: [MessageBodyPart] = []
    // Web draws it at the top of a settled body, above the Thought and the text; not while the row is edited (row 38c).
    if !isEditing, let label = SokoBotSourceLabel(message: message) {
      parts.append(.sokoBotSource(label))
    }
    if case .failed? = shell {
      parts.append(.failedMention)
    } else if hasThoughtView(message) {
      // A persisted mention shell keeps the live Thought header until Core fills the answer; its clock starts at
      // `thought_timing_ms.start`.
      parts.append(.thought(startedAt: shell?.startedAt ?? message.createdAt, shellWorking: shell != nil))
    }
    if isDeleted {
      parts.append(.deleted)
      return parts
    }
    if message.quote != nil {
      parts.append(.quote)
    }
    if isEditing {
      parts.append(.editComposer)
    } else if shell == nil, let reply = ProjectSelectionReply(content: message.content) {
      // A project question's answer (row 38h1) is the chosen project, not its raw sentence and id.
      parts.append(.projectSelection(reply))
    } else if shell == nil, message.quote == nil || !message.content.isEmpty {
      // Mention shells render their own state; Send to yourself posts only a quote, so there is no body to render.
      parts.append(.markdown)
    }
    return parts
  }
}

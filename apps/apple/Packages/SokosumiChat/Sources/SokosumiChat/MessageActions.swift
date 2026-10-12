/// One entry of a message's right-click menu. The row's menu and its accessibility actions read the same list; the
/// app owns each entry's title, symbol and shortcut.
public enum MessageMenuAction: Hashable, Sendable {
  /// Copies the reader's text selection in this message.
  case copySelection
  /// A Soko Bot turn's thumbs (row 38b).
  case useful, notUseful
  case addReaction, edit, quote, reply
  case pin, unpin, copyLink, sendToSelf
  case delete
}

/// What a message offers its reader, before anything is wired to it.
public struct MessageActions: Equatable, Sendable {
  /// A Soko Bot turn carries the useful / not useful thumbs.
  public var offersFeedback = false
  public var canReact = false
  public var canEdit = false
  public var canQuote = false
  public var canReply = false
  public var canPin = false
  public var canCopyLink = false
  public var canSendToSelf = false
  public var canDelete = false

  public init(
    offersFeedback: Bool = false, canReact: Bool = false, canEdit: Bool = false, canQuote: Bool = false,
    canReply: Bool = false, canPin: Bool = false, canCopyLink: Bool = false, canSendToSelf: Bool = false,
    canDelete: Bool = false
  ) {
    self.offersFeedback = offersFeedback
    self.canReact = canReact
    self.canEdit = canEdit
    self.canQuote = canQuote
    self.canReply = canReply
    self.canPin = canPin
    self.canCopyLink = canCopyLink
    self.canSendToSelf = canSendToSelf
    self.canDelete = canDelete
  }

  public var isEmpty: Bool {
    self == MessageActions()
  }

  /// Web's hover pill order (a Soko Bot turn's thumbs, then React, Edit, Quote, Thread), then its ⋯ overflow
  /// order (Pin, Copy link, Send to yourself), then Delete on its own: the Mac puts the destructive action
  /// last. A text selection in the message puts Copy first, as in any Mac text menu.
  public func menuSections(hasSelection: Bool, isPinned: Bool) -> [[MessageMenuAction]] {
    let thumbs: [MessageMenuAction] = offersFeedback ? [.useful, .notUseful] : []
    let toolbar: [MessageMenuAction?] = [canReact ? .addReaction : nil, canEdit ? .edit : nil,
                                         canQuote ? .quote : nil, canReply ? .reply : nil]
    let overflow: [MessageMenuAction?] = [canPin ? (isPinned ? .unpin : .pin) : nil,
                                          canCopyLink ? .copyLink : nil, canSendToSelf ? .sendToSelf : nil]
    return [hasSelection ? [.copySelection] : [], thumbs, toolbar.compactMap(\.self), overflow.compactMap(\.self),
            canDelete ? [.delete] : []].filter { !$0.isEmpty }
  }
}

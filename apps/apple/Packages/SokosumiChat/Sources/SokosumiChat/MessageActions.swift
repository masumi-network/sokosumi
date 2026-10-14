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

  /// The hover pill's buttons after a Soko Bot turn's thumbs, in web's order: React, Edit, Quote, Thread (`reply`).
  /// Web's pill never puts Edit in ⋯ More.
  public var toolbar: [MessageMenuAction] {
    [canReact ? .addReaction : nil, canEdit ? .edit : nil, canQuote ? .quote : nil, canReply ? .reply : nil]
      .compactMap(\.self)
  }

  /// Web's ⋯ More menu in its order (Pin or Unpin, Copy link, Send to yourself), then Delete on its own: the Mac puts
  /// the destructive action last and sets it apart.
  public func overflowSections(isPinned: Bool) -> [[MessageMenuAction]] {
    let rest: [MessageMenuAction?] = [canPin ? (isPinned ? .unpin : .pin) : nil, canCopyLink ? .copyLink : nil,
                                      canSendToSelf ? .sendToSelf : nil]
    return [rest.compactMap(\.self), canDelete ? [.delete] : []].filter { !$0.isEmpty }
  }

  /// Whether the pill carries ⋯ More. Edit is a pill button, not an overflow entry, so it does not count.
  public var offersOverflow: Bool {
    canPin || canCopyLink || canSendToSelf || canDelete
  }

  /// Web's hover pill order (a Soko Bot turn's thumbs, then `toolbar`), then its ⋯ overflow order, then Delete on
  /// its own. A text selection in the message puts Copy first, as in any Mac text menu.
  public func menuSections(hasSelection: Bool, isPinned: Bool) -> [[MessageMenuAction]] {
    let thumbs: [MessageMenuAction] = offersFeedback ? [.useful, .notUseful] : []
    return ([hasSelection ? [.copySelection] : [], thumbs, toolbar] + overflowSections(isPinned: isPinned))
      .filter { !$0.isEmpty }
  }
}

/// Which of a row's requests are running. A running request disables its own entry in every menu that offers it, and
/// leaves the rest usable.
public struct MessageRowActivity: Equatable, Sendable {
  public var isDeleting = false
  public var isSendingToSelf = false
  public var isUpdatingPin = false
  /// The Soko Bot turn's rating is being sent or already stuck.
  public var feedbackLocked = false

  public init(isDeleting: Bool = false, isSendingToSelf: Bool = false, isUpdatingPin: Bool = false,
              feedbackLocked: Bool = false) {
    self.isDeleting = isDeleting
    self.isSendingToSelf = isSendingToSelf
    self.isUpdatingPin = isUpdatingPin
    self.feedbackLocked = feedbackLocked
  }

  /// The entries to show but not allow: pin covers pin and unpin, a locked rating covers both thumbs.
  public var busy: Set<MessageMenuAction> {
    var busy: Set<MessageMenuAction> = []
    if isDeleting {
      busy.insert(.delete)
    }
    if isSendingToSelf {
      busy.insert(.sendToSelf)
    }
    if isUpdatingPin {
      busy.formUnion([.pin, .unpin])
    }
    if feedbackLocked {
      busy.formUnion([.useful, .notUseful])
    }
    return busy
  }
}

/// Which of a row's requests are running. A running request disables its own entry in every menu that offers it, and
/// leaves the rest usable.
public struct MessageRowActivity: Equatable, Sendable {
  public var isDeleting = false
  public var isSendingToSelf = false
  public var isUpdatingPin = false
  /// The Soko Bot turn's rating is being sent or already stuck.
  public var feedbackLocked = false

  public init(isDeleting: Bool = false, isSendingToSelf: Bool = false, isUpdatingPin: Bool = false,
              feedbackLocked: Bool = false) {
    self.isDeleting = isDeleting
    self.isSendingToSelf = isSendingToSelf
    self.isUpdatingPin = isUpdatingPin
    self.feedbackLocked = feedbackLocked
  }

  /// The entries to show but not allow: pin covers pin and unpin, a locked rating covers both thumbs.
  public var busy: Set<MessageMenuAction> {
    var busy: Set<MessageMenuAction> = []
    if isDeleting {
      busy.insert(.delete)
    }
    if isSendingToSelf {
      busy.insert(.sendToSelf)
    }
    if isUpdatingPin {
      busy.formUnion([.pin, .unpin])
    }
    if feedbackLocked {
      busy.formUnion([.useful, .notUseful])
    }
    return busy
  }
}

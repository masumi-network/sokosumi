#if os(macOS)
  import AppKit
  import SwiftUI

  /// One entry of a message's right-click menu. The row's menu and its accessibility actions read the same list.
  enum MessageMenuAction: Hashable {
    /// Copies the reader's text selection in this message.
    case copySelection
    case addReaction, edit, quote, reply
    case pin, unpin, copyLink, sendToSelf
    case delete

    var title: String {
      switch self {
      case .copySelection: String(localized: "Copy")
      case .addReaction: String(localized: "Add reaction")
      case .edit: String(localized: "Edit message")
      case .quote: String(localized: "Quote message")
      case .reply: String(localized: "Reply in thread")
      case .pin: String(localized: "Pin message")
      case .unpin: String(localized: "Unpin message")
      case .copyLink: String(localized: "Copy link")
      case .sendToSelf: String(localized: "Send to yourself")
      case .delete: String(localized: "Delete message")
      }
    }

    var systemImage: String {
      switch self {
      case .copySelection: "doc.on.doc"
      case .addReaction: "face.smiling"
      case .edit: "pencil"
      case .quote: "quote.opening"
      case .reply: "bubble.right"
      case .pin: "pin"
      case .unpin: "pin.slash"
      case .copyLink: "link"
      case .sendToSelf: "paperplane"
      case .delete: "trash"
      }
    }
  }

  /// The actions a message row offers, filled from its callbacks.
  struct MessageMenuAvailability: Equatable {
    var canReact = false
    var canEdit = false
    var canQuote = false
    var canReply = false
    /// Nil where messages cannot be pinned; otherwise whether this one is pinned.
    var pinned: Bool?
    var canCopyLink = false
    var canSendToSelf = false
    var canDelete = false

    /// Web's hover pill order (React, Edit, Quote, Thread), then its ⋯ overflow order (Pin, Copy link,
    /// Send to yourself), then Delete on its own: the Mac puts the destructive action last. A text
    /// selection in the message puts Copy first, as in any Mac text menu.
    func sections(hasSelection: Bool) -> [[MessageMenuAction]] {
      let toolbar: [MessageMenuAction?] = [canReact ? .addReaction : nil, canEdit ? .edit : nil,
                                           canQuote ? .quote : nil, canReply ? .reply : nil]
      let overflow: [MessageMenuAction?] = [pinned.map { $0 ? .unpin : .pin },
                                            canCopyLink ? .copyLink : nil, canSendToSelf ? .sendToSelf : nil]
      return [hasSelection ? [.copySelection] : [], toolbar.compactMap(\.self), overflow.compactMap(\.self),
              canDelete ? [.delete] : []].filter { !$0.isEmpty }
    }
  }

  /// Opens the message's menu for a right-click or Control-click anywhere on the row, the body text included.
  /// Selectable SwiftUI `Text` is an AppKit view that answers a right-click with its own editing menu (Cut, Paste,
  /// Font, Spelling…), and SwiftUI's `.contextMenu` never sees that click. Every other event passes through.
  struct MessageContextMenuArea: NSViewRepresentable {
    let availability: MessageMenuAvailability
    /// Actions shown but disabled while their request runs.
    let busy: Set<MessageMenuAction>
    let perform: (MessageMenuAction) -> Void

    func makeNSView(context _: Context) -> MessageContextMenuView {
      MessageContextMenuView()
    }

    func updateNSView(_ view: MessageContextMenuView, context _: Context) {
      view.availability = availability
      view.busy = busy
      view.perform = perform
    }
  }

  final class MessageContextMenuView: NSView {
    var availability = MessageMenuAvailability()
    var busy: Set<MessageMenuAction> = []
    var perform: (MessageMenuAction) -> Void = { _ in }
    private var isLookingBeneath = false

    override func hitTest(_ point: NSPoint) -> NSView? {
      guard !isLookingBeneath, let event = NSApp.currentEvent, Self.opensContextMenu(event),
            let hit = super.hitTest(point)
      else { return nil }
      // The inline edit composer keeps its own editing menu.
      return editableText(at: point) ? nil : hit
    }

    override func menu(for _: NSEvent) -> NSMenu? {
      let selection = selectedMessageText()
      let sections = availability.sections(hasSelection: selection != nil)
      guard !sections.isEmpty else { return nil }
      let menu = NSMenu()
      menu.autoenablesItems = false
      for section in sections {
        if !menu.items.isEmpty {
          menu.addItem(.separator())
        }
        for action in section {
          menu.addItem(item(for: action, selection: selection))
        }
      }
      return menu
    }

    /// A right-click opens the menu in a background window too; Control-click matches it.
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool {
      event.map(Self.opensContextMenu) ?? false
    }

    static func opensContextMenu(_ event: NSEvent) -> Bool {
      event.type == .rightMouseDown || (event.type == .leftMouseDown && event.modifierFlags.contains(.control))
    }

    private func item(for action: MessageMenuAction, selection: NSView?) -> NSMenuItem {
      let title = action == .delete && busy.contains(.delete) ? String(localized: "Deleting…") : action.title
      let item = NSMenuItem(title: title, action: #selector(performMenuAction(_:)), keyEquivalent: "")
      item.target = self
      if action == .copySelection {
        // The text view copies its own selection, rich text included, as Command-C does.
        item.action = #selector(NSText.copy(_:))
        item.target = selection
      }
      item.representedObject = action
      item.image = NSImage(systemSymbolName: action.systemImage, accessibilityDescription: nil)
      item.isEnabled = !busy.contains(action)
      return item
    }

    @objc private func performMenuAction(_ sender: NSMenuItem) {
      guard let action = sender.representedObject as? MessageMenuAction else { return }
      perform(action)
    }

    /// Whether the view under `point` (in the superview's coordinates) is an editable text view.
    private func editableText(at point: NSPoint) -> Bool {
      guard let superview, let root = window?.contentView else { return false }
      isLookingBeneath = true
      defer { isLookingBeneath = false }
      let beneath = root.hitTest(superview.convert(point, to: root.superview))
      return sequence(first: beneath, next: { $0?.superview }).contains { ($0 as? NSTextView)?.isEditable == true }
    }

    /// The read-only text view holding a selection inside this message, if any.
    private func selectedMessageText() -> NSView? {
      guard let text = window?.firstResponder as? NSView,
            (text as? NSTextView)?.isEditable != true,
            text.accessibilitySelectedTextRange().length > 0,
            text.responds(to: #selector(NSText.copy(_:)))
      else { return nil }
      let messageFrame = convert(bounds, to: nil)
      return messageFrame.intersects(text.convert(text.visibleRect, to: nil)) ? text : nil
    }
  }
#endif

#if os(macOS)
  import CoreAPI
  import Foundation
  @testable import Sokosumi
  import SokosumiChat
  import Testing

  /// M7: the message menu's order and separators. Each row mirrors the callbacks its call site passes:
  /// `RoomTimelineView` for room rows, `ReplyThreadView` for the thread parent and its replies.
  @MainActor struct MessageMenuOrderTests {
    private static func message(from sender: String = "Ada") -> Components.Schemas.ChatRoomMessage {
      var message = chatRoomMessage(from: .init(
        clientTurnId: "turn", roomId: "room_1", content: "Release notes are up.",
        sender: .init(id: "user_\(sender)", name: sender, email: "\(sender.lowercased())@example.com", presence: .offline)
      ))
      message.id = "message_1"
      message.metadata = nil
      return message
    }

    /// Callbacks are present exactly where the call site passes them.
    private static func row(own: Bool, pin: Bool?, reply: Bool = true,
                            message: Components.Schemas.ChatRoomMessage = message()) -> MessageRowView {
      MessageRowView(message: message, isContinuation: false, outbound: nil, onRetry: nil, onRemove: nil,
                     onReply: reply ? {} : nil,
                     onQuote: {},
                     onEdit: own ? {} : nil,
                     isPinned: pin ?? false,
                     onTogglePin: pin == nil ? nil : {},
                     onDelete: own ? {} : nil,
                     onToggleReaction: { _ in true },
                     onSendToSelf: { message })
    }

    @Test func ownUnpinnedChannelMessage() {
      #expect(Self.row(own: true, pin: false).menuAvailability.sections(hasSelection: false) == [
        [.addReaction, .edit, .quote, .reply],
        [.pin, .copyLink, .sendToSelf],
        [.delete]
      ])
    }

    @Test func ownPinnedChannelMessage() {
      #expect(Self.row(own: true, pin: true).menuAvailability.sections(hasSelection: false) == [
        [.addReaction, .edit, .quote, .reply],
        [.unpin, .copyLink, .sendToSelf],
        [.delete]
      ])
    }

    @Test func othersUnpinnedChannelMessage() {
      #expect(Self.row(own: false, pin: false, message: Self.message(from: "Ben")).menuAvailability.sections(hasSelection: false) == [
        [.addReaction, .quote, .reply],
        [.pin, .copyLink, .sendToSelf]
      ])
    }

    @Test func othersPinnedChannelMessage() {
      #expect(Self.row(own: false, pin: true, message: Self.message(from: "Ben")).menuAvailability.sections(hasSelection: false) == [
        [.addReaction, .quote, .reply],
        [.unpin, .copyLink, .sendToSelf]
      ])
    }

    /// Directs have no message pins (web `showPinButton={!isDirectRoom}`; Apple `canUsePins` is channels only).
    @Test func ownMessageInADirect() {
      #expect(Self.row(own: true, pin: nil).menuAvailability.sections(hasSelection: false) == [
        [.addReaction, .edit, .quote, .reply],
        [.copyLink, .sendToSelf],
        [.delete]
      ])
    }

    /// `ReplyThreadView` passes neither Reply nor Pin, for the parent or its replies; web shows no pin in a thread.
    @Test(arguments: [true, false])
    func threadParentAndReplies(own: Bool) {
      let expected: [[MessageMenuAction]] = own
        ? [[.addReaction, .edit, .quote], [.copyLink, .sendToSelf], [.delete]]
        : [[.addReaction, .quote], [.copyLink, .sendToSelf]]
      #expect(Self.row(own: own, pin: nil, reply: false).menuAvailability.sections(hasSelection: false) == expected)
    }

    @Test func aSelectionPutsCopyFirst() {
      let sections = Self.row(own: false, pin: nil).menuAvailability.sections(hasSelection: true)
      #expect(sections == [[.copySelection], [.addReaction, .quote, .reply], [.copyLink, .sendToSelf]])
    }

    @Test func aSelectionAloneStillOffersCopy() {
      #expect(MessageMenuAvailability().sections(hasSelection: true) == [[.copySelection]])
      #expect(MessageMenuAvailability().sections(hasSelection: false).isEmpty)
    }

    /// A deleted thread root keeps its tombstone row; the actions that need a live message leave its menu.
    @Test func deletedMessageDropsLiveActions() {
      var message = Self.message()
      message.deletedAt = Date(timeIntervalSince1970: 1_767_268_800)
      let actions = Self.row(own: true, pin: nil, message: message).menuAvailability.sections(hasSelection: false).joined()
      #expect(!actions.contains(.addReaction))
      #expect(!actions.contains(.reply))
      #expect(!actions.contains(.copyLink))
      #expect(!actions.contains(.delete))
    }
  }
#endif

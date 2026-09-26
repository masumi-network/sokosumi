import CoreAPI
import Foundation
import SokosumiAuth
import SokosumiChat

public extension WorkspaceState {
  /// The quote a paste into `roomId` becomes, or nil when the pasted text must
  /// stay a plain link. Core applies the same audience rule at send time.
  func messageLinkQuote(pasted: String, roomId: String, webBaseURL: URL, auth: AuthState) async -> Components.Schemas.ChatRoomMessageQuote? {
    guard let link = pastedMessageLink(pasted, webBaseURL: webBaseURL),
          let target = rooms.first(where: { $0.id == roomId }),
          let client = resolveClient(auth: auth) else { return nil }
    let slug = selection?.workspace.organizationSlug
    return await SokosumiChat.messageLinkQuote(
      link, targetRoom: target, rooms: rooms,
      // The coworker stream endpoint only takes same-room quotes.
      allowCrossRoom: directStream.roomId != roomId,
      loadMessage: { sourceRoomId, messageId in
        try? await ChatService().getMessage(client: client, roomId: sourceRoomId, messageId: messageId, organizationSlug: slug)
      }
    )
  }
}

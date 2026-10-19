import CoreAPI

public extension ChatService {
  /// `POST /soko-bots/me/turns/{id}/feedback`: the owner's useful / not useful
  /// rating of one Soko Bot turn. Turns are user-scoped, so the operation
  /// carries no organization header. 404 = not one of the caller's turns.
  /// Returns the stored value.
  func sendSokoBotTurnFeedback(client: Client, turnId: String, useful: Bool) async throws -> Bool {
    try await call {
      try await client.sendMySokoBotTurnFeedback(.init(
        path: .init(id: turnId),
        body: .json(.init(useful: useful))
      ))
    }.ok.body.json.data.useful
  }
}

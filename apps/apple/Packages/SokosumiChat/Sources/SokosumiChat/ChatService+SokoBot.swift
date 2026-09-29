import CoreAPI

public extension ChatService {
  /// `POST /soko-bots/me/turns/{id}/feedback`: the owner's useful / not useful
  /// rating of one Soko Bot turn. Turns are user-scoped, so the operation
  /// carries no organization header. 404 = not one of the caller's turns.
  /// Returns the stored value.
  func sendSokoBotTurnFeedback(client: Client, turnId: String, useful: Bool) async throws -> Bool {
    let response = try await client.sendMySokoBotTurnFeedback(.init(
      path: .init(id: turnId),
      body: .json(.init(useful: useful))
    ))
    switch response {
    case let .ok(value): return try value.body.json.data.useful
    case let .unauthorized(value): throw try unauthorized(value.body.json.message)
    case let .notFound(value): throw try rejected(status: 404, message: value.body.json.message)
    case let .undocumented(statusCode, payload): throw await unprocessableError(statusCode: statusCode, payload: payload)
    }
  }
}

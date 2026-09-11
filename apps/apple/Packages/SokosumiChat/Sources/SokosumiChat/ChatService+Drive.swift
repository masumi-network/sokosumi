import CoreAPI
import Foundation

public extension ChatService {
  func driveItems(client: Client, organizationId: String?, folder: String, query: String) async throws -> [Components.Schemas.DriveItem] {
    var items: [Components.Schemas.DriveItem] = []
    var cursor: String?
    var seen: Set<String> = []
    for _ in 0 ..< 50 {
      try Task.checkCancellation()
      let page = try await drivePage(client: client, organizationId: organizationId, folder: folder, query: query, cursor: cursor)
      items += page.data
      guard let next = page.meta.pagination.nextCursor else { return items }
      guard seen.insert(next).inserted else { throw ChatServiceError.unexpectedResponse("Drive returned a repeated page. Try again.") }
      cursor = next
    }
    throw ChatServiceError.unexpectedResponse("This folder has too many files. Refine your search.")
  }

  private func drivePage(client: Client, organizationId: String?, folder: String, query: String, cursor: String?) async throws -> Operations.GetDriveFiles.Output.Ok.Body.JsonPayload {
    let response = try await client.getDriveFiles(.init(query: .init(
      scope: organizationId == nil ? .me : .org, organizationId: organizationId,
      folder: folder.isEmpty ? nil : folder, q: query.isEmpty ? nil : query, cursor: cursor, limit: 100
    )))
    switch response {
    case let .ok(value): return try value.body.json
    case let .unauthorized(value): throw try ChatServiceError.unauthorized(value.body.json.message)
    case let .badRequest(value): throw try ChatServiceError.unprocessable(statusCode: 400, message: value.body.json.message)
    case let .forbidden(value): throw try ChatServiceError.unprocessable(statusCode: 403, message: value.body.json.message)
    case let .notFound(value): throw try ChatServiceError.unprocessable(statusCode: 404, message: value.body.json.message)
    case let .unprocessableContent(value): throw try ChatServiceError.unprocessable(statusCode: 422, message: value.body.json.message)
    case let .serviceUnavailable(value): throw try ChatServiceError.unprocessable(statusCode: 503, message: value.body.json.message)
    case let .undocumented(statusCode, payload): throw await unprocessableError(statusCode: statusCode, payload: payload)
    }
  }
}

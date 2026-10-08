import CoreAPI
import Foundation
import OpenAPIRuntime

public extension ChatService {
  /// A result output's bytes through its Core content operation (row 38e2), the call web's proxy routes make with the
  /// session: `GET /drive/resources/{id}/content`, `GET /jobs/{id}/files/{fileId}/content` or
  /// `GET /projects/{id}/image-studio/assets/{assetId}/content`, in the workspace `organizationSlug` names. Core checks
  /// access on every read and answers no 304 (no conditional request is sent); 401 is the session, 403 and 404 a file
  /// this viewer may not or can no longer read, 503 storage that is not reachable now.
  func resultOutput(client: Client, source: ResultOutputSource, fileName: String, organizationSlug: String?) async throws -> ResultOutputFile {
    let body = switch source {
    case let .driveFile(id, scope, organizationId, download):
      try await driveFileContent(
        client: client, id: id,
        query: .init(scope: scope == .organization ? .org : .me, organizationId: organizationId, download: download ? ._true : nil),
        organizationSlug: organizationSlug
      )
    case let .jobFile(jobId, fileId, download):
      try await jobFileContent(client: client, jobId: jobId, fileId: fileId, download: download, organizationSlug: organizationSlug)
    case let .studioAsset(projectId, assetId):
      try await studioAssetContent(client: client, projectId: projectId, assetId: assetId, organizationSlug: organizationSlug)
    }
    return try await Self.write(body, named: fileName)
  }
}

extension ChatService {
  private func driveFileContent(client: Client, id: String, query: Operations.GetDriveResourcesIdContent.Input.Query,
                                organizationSlug: String?) async throws -> HTTPBody {
    let response = try await client.getDriveResourcesIdContent(.init(
      path: .init(id: id), query: query, headers: .init(xOrganizationSlug: organizationSlug)
    ))
    switch response {
    case let .ok(value): return try value.body.any
    case let .badRequest(value): throw try rejected(status: 400, message: value.body.json.message)
    case let .unauthorized(value): throw try unauthorized(value.body.json.message)
    case let .forbidden(value): throw try rejected(status: 403, message: value.body.json.message)
    case let .notFound(value): throw try rejected(status: 404, message: value.body.json.message)
    case let .serviceUnavailable(value): throw try rejected(status: 503, message: value.body.json.message)
    case let .undocumented(statusCode, payload): throw await unprocessableError(statusCode: statusCode, payload: payload)
    }
  }

  private func jobFileContent(client: Client, jobId: String, fileId: String, download: Bool, organizationSlug: String?) async throws -> HTTPBody {
    let response = try await client.getJobsIdFilesFileIdContent(.init(
      path: .init(id: jobId, fileId: fileId),
      query: .init(download: download ? ._true : nil),
      headers: .init(xOrganizationSlug: organizationSlug)
    ))
    switch response {
    case let .ok(value): return try value.body.any
    case let .badRequest(value): throw try rejected(status: 400, message: value.body.json.message)
    case let .unauthorized(value): throw try unauthorized(value.body.json.message)
    case let .forbidden(value): throw try rejected(status: 403, message: value.body.json.message)
    case let .notFound(value): throw try rejected(status: 404, message: value.body.json.message)
    case let .serviceUnavailable(value): throw try rejected(status: 503, message: value.body.json.message)
    case let .undocumented(statusCode, payload): throw await unprocessableError(statusCode: statusCode, payload: payload)
    }
  }

  private func studioAssetContent(client: Client, projectId: String, assetId: String, organizationSlug: String?) async throws -> HTTPBody {
    let response = try await client.getProjectsIdImageStudioAssetsAssetIdContent(.init(
      path: .init(id: projectId, assetId: assetId),
      headers: .init(xOrganizationSlug: organizationSlug)
    ))
    switch response {
    case let .ok(value): return try value.body.image_Ast_
    case let .unauthorized(value): throw try unauthorized(value.body.json.message)
    case let .forbidden(value): throw try rejected(status: 403, message: value.body.json.message)
    case let .notFound(value): throw try rejected(status: 404, message: value.body.json.message)
    case let .serviceUnavailable(value): throw try rejected(status: 503, message: value.body.json.message)
    case let .undocumented(statusCode, payload): throw await unprocessableError(statusCode: statusCode, payload: payload)
    }
  }

  /// Streams the body into `<temporary>/ResultOutputs/<unique>/<fileName>`, so a large video never sits in memory.
  private static func write(_ body: HTTPBody, named fileName: String) async throws -> ResultOutputFile {
    let folder = FileManager.default.temporaryDirectory
      .appending(path: "ResultOutputs", directoryHint: .isDirectory)
      .appending(path: UUID().uuidString, directoryHint: .isDirectory)
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    // Owns the folder from here, so a failed or cancelled read leaves nothing behind.
    let file = ResultOutputFile(url: folder.appending(path: fileName, directoryHint: .notDirectory))
    guard FileManager.default.createFile(atPath: file.url.path, contents: nil) else {
      throw CocoaError(.fileWriteUnknown)
    }
    let handle = try FileHandle(forWritingTo: file.url)
    defer { try? handle.close() }
    for try await chunk in body {
      try Task.checkCancellation()
      try handle.write(contentsOf: chunk)
    }
    return file
  }
}

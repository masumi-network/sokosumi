import Foundation
import HTTPTypes
import OpenAPIRuntime

/// Core no longer serves this build: it is below the minimum, or it called an
/// operation Core has removed.
public struct CoreUpdateRequired: Error, Equatable, Sendable {
  public init() {}
}

/// Names the build on every Core request (`X-Sokosumi-Client: macos-developer-id/<build>`; the
/// token stays because shipped builds send it, ADR 0053) and turns
/// Core's `client_update_required` 426 and `route_not_found` 404 into `CoreUpdateRequired`.
public struct ClientBuildMiddleware: ClientMiddleware {
  static let headerName = HTTPField.Name("X-Sokosumi-Client")!
  private static let updateKinds: [Int: String] = [426: "client_update_required", 404: "route_not_found"]
  private static let maxEnvelopeBytes = 64 * 1024

  let build: String

  public init(build: String) {
    self.build = build
  }

  public func intercept(
    _ request: HTTPRequest,
    body: HTTPBody?,
    baseURL: URL,
    operationID _: String,
    next: @Sendable (HTTPRequest, HTTPBody?, URL) async throws -> (HTTPResponse, HTTPBody?)
  ) async throws -> (HTTPResponse, HTTPBody?) {
    var request = request
    request.headerFields[Self.headerName] = "macos-developer-id/\(build)"
    let (response, responseBody) = try await next(request, body, baseURL)
    // Core's error envelope is small; a body known to be larger is not one, so it passes untouched.
    guard let kind = Self.updateKinds[response.status.code], let responseBody,
          responseBody.length.fits(Self.maxEnvelopeBytes) else {
      return (response, responseBody)
    }
    // Collect once, then hand the bytes on: the collected stream cannot be replayed.
    let bytes = try await Array(collecting: responseBody, upTo: Self.maxEnvelopeBytes)
    let json = try? JSONSerialization.jsonObject(with: Data(bytes)) as? [String: Any]
    if json?["kind"] as? String == kind {
      throw CoreUpdateRequired()
    }
    return (response, HTTPBody(bytes))
  }
}

private extension HTTPBody.Length {
  func fits(_ limit: Int) -> Bool {
    guard case let .known(length) = self else { return true }
    return length <= limit
  }
}

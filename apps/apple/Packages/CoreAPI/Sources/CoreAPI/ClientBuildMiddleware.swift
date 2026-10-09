import Foundation
import HTTPTypes
import OpenAPIRuntime

/// Where a build was published; each channel numbers its builds on its own (ADR 0053).
public enum DistributionChannel: String, Sendable {
  /// The notarized `apple-latest` disk image, numbered by the Apple workflow run.
  case developerID = "developer-id"
  /// Xcode Cloud: TestFlight and the App Store.
  case appStore = "app-store"
}

/// Core no longer serves this build: it is below its channel's minimum, or it
/// called an operation Core has removed.
public struct CoreUpdateRequired: Error, Equatable, Sendable {
  public let channel: DistributionChannel

  public init(channel: DistributionChannel) {
    self.channel = channel
  }
}

/// Names the build on every Core request (`X-Sokosumi-Client: macos-<channel>/<build>`) and turns
/// Core's `client_update_required` 426 and `route_not_found` 404 into `CoreUpdateRequired`.
public struct ClientBuildMiddleware: ClientMiddleware {
  static let headerName = HTTPField.Name("X-Sokosumi-Client")!
  private static let updateKinds: [Int: String] = [426: "client_update_required", 404: "route_not_found"]
  private static let maxEnvelopeBytes = 64 * 1024

  let channel: DistributionChannel
  let build: String

  public init(channel: DistributionChannel, build: String) {
    self.channel = channel
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
    request.headerFields[Self.headerName] = "macos-\(channel.rawValue)/\(build)"
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
      throw CoreUpdateRequired(channel: channel)
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

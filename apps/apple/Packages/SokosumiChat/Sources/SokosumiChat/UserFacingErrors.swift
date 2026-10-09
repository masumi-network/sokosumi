import CoreAPI
import Foundation
import OpenAPIRuntime

/// How Chat surfaces an error to the user.
public enum UserFacingErrorMode: Sendable {
  /// Window chrome: wrap Core `unprocessable` with status; hide `unauthorized`.
  case window
  /// Forms: Core's message as-is, then typed upload copy, then window-safe fallback.
  case coreMessage
}

/// Short user-facing message. Default is window-safe (SOK-973): never interpolate an
/// unknown error, because bridging a wrapped `URLError` dumps the `NSError` chain.
public func friendlyMessage(for error: Error, mode: UserFacingErrorMode = .window) -> String {
  if let serviceError = error as? ChatServiceError {
    return chatServiceMessage(serviceError, mode: mode)
  }
  if let failure = error as? AttachmentUpload.Failure, let description = failure.errorDescription {
    return description
  }
  if updateRequired(in: error) != nil {
    return updateMessage
  }
  if let urlError = findURLError(in: error) {
    return urlErrorMessage(urlError)
  }
  return "Couldn't reach Core. Check your connection and try again."
}

/// The newest Stable disk image (ADR 0054).
public let latestDownloadURL = URL(string: "https://github.com/masumi-network/sokosumi/releases/download/macos-latest/Sokosumi.dmg")!

/// `ClientBuildMiddleware` throws inside the generated client, which wraps it in `ClientError`.
public func updateRequired(in error: Error) -> CoreUpdateRequired? {
  error as? CoreUpdateRequired ?? (error as? ClientError)?.underlyingError as? CoreUpdateRequired
}

public let updateMessage = "This version of Sokosumi is out of date. Download the latest version: \(latestDownloadURL.absoluteString)"

private func chatServiceMessage(_ error: ChatServiceError, mode: UserFacingErrorMode) -> String {
  switch error {
  case let .unprocessable(statusCode, message):
    unprocessableMessage(statusCode: statusCode, message: message, mode: mode)
  case let .unexpectedResponse(message):
    message
  case let .unauthorized(message):
    unauthorizedMessage(message, mode: mode)
  case .blocked:
    "Couldn't complete the request. Try again."
  }
}

private func unprocessableMessage(statusCode: Int, message: String, mode: UserFacingErrorMode) -> String {
  switch mode {
  case .coreMessage: message
  case .window: "Core rejected the request (\(statusCode)): \(message)"
  }
}

private func unauthorizedMessage(_ message: String, mode: UserFacingErrorMode) -> String {
  switch mode {
  case .coreMessage: message
  case .window: "Couldn't complete the request. Try again."
  }
}

private func urlErrorMessage(_ urlError: URLError) -> String {
  // Explicit strings: a bare `URLError.localizedDescription` degrades to
  // "The operation couldn't be completed. (NSURLErrorDomain error N.)",
  // which is exactly the dump this replaces.
  switch urlError.code {
  case .notConnectedToInternet:
    "No network connection. Check your connection and try again."
  case .networkConnectionLost:
    "The network connection was lost."
  case .timedOut:
    "The request timed out. Please try again."
  default:
    "Couldn't reach Core. Check your connection and try again."
  }
}

/// `as? URLError` misses raw `NSError(NSURLErrorDomain)` values, which the
/// transport layer can throw; match those by domain too.
private func asURLError(_ error: Error) -> URLError? {
  if let urlError = error as? URLError {
    return urlError
  }
  let nsError = error as NSError
  if nsError.domain == NSURLErrorDomain as String {
    return URLError(URLError.Code(rawValue: nsError.code), userInfo: nsError.userInfo)
  }
  return nil
}

private func findURLError(in error: Error) -> URLError? {
  if let urlError = asURLError(error) {
    return urlError
  }
  var seen = Set<ObjectIdentifier>()
  var stack: [Error] = (error as NSError).userInfo.values.compactMap { $0 as? Error }
  while let next = stack.popLast() {
    if let urlError = asURLError(next) {
      return urlError
    }
    let nextNS = next as NSError
    let id = ObjectIdentifier(nextNS)
    guard seen.insert(id).inserted else { continue }
    stack.append(contentsOf: nextNS.userInfo.values.compactMap { $0 as? Error })
  }
  return nil
}

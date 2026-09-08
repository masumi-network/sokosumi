import Foundation

/// Short, window-safe message for errors the typed client cannot classify
/// (transport failures, coding errors). The full error still belongs in the
/// log — never interpolate an unknown error into the UI, because bridging a
/// wrapped `URLError` to text dumps the whole `NSError` chain (SOK-973
/// follow-up: a -1005 filled the window).
public func friendlyMessage(for error: Error) -> String {
  if let urlError = findURLError(in: error) {
    // Explicit strings: a bare `URLError.localizedDescription` degrades to
    // "The operation couldn't be completed. (NSURLErrorDomain error N.)",
    // which is exactly the dump this replaces.
    switch urlError.code {
    case .notConnectedToInternet:
      return "No network connection. Check your connection and try again."
    case .networkConnectionLost:
      return "The network connection was lost."
    case .timedOut:
      return "The request timed out. Please try again."
    default:
      return "Couldn't reach Core. Check your connection and try again."
    }
  }
  return "Couldn't reach Core. Check your connection and try again."
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

import Foundation
import OpenAPIRuntime
import OpenAPIURLSession

extension Client {
  /// Core JSON dates include fractional seconds.
  public static func connecting(
    to serverURL: URL,
    transport: any ClientTransport
  ) -> Client {
    Client(
      serverURL: serverURL,
      configuration: .init(dateTranscoder: .iso8601WithFractionalSeconds),
      transport: transport
    )
  }

  /// Fake-transport variant that also runs middlewares, so tests cover the
  /// app's real middleware stack (e.g. explicit-null rewrite).
  public static func connecting(
    to serverURL: URL,
    transport: any ClientTransport,
    middlewares: [any ClientMiddleware]
  ) -> Client {
    Client(
      serverURL: serverURL,
      configuration: .init(dateTranscoder: .iso8601WithFractionalSeconds),
      transport: transport,
      middlewares: middlewares
    )
  }

  public static func connecting(
    to serverURL: URL,
    middlewares: [any ClientMiddleware] = [],
    session: URLSession = .shared
  ) -> Client {
    Client(
      serverURL: serverURL,
      configuration: .init(dateTranscoder: .iso8601WithFractionalSeconds),
      transport: URLSessionTransport(configuration: .init(session: session)),
      middlewares: middlewares
    )
  }
}

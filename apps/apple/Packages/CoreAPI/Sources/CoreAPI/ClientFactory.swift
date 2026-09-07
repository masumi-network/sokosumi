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

  public static func connecting(
    to serverURL: URL,
    session: URLSession = .shared
  ) -> Client {
    connecting(
      to: serverURL,
      transport: URLSessionTransport(configuration: .init(session: session))
    )
  }
}

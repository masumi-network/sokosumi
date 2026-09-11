import Combine
import CoreAPI
import Foundation

@MainActor
public final class DrivePicker: ObservableObject {
  @Published public private(set) var items: [Components.Schemas.DriveItem] = []
  @Published public private(set) var loading = false
  @Published public private(set) var errorMessage: String?
  private var generation = 0

  public init() {}

  public func load(using fetch: () async throws -> [Components.Schemas.DriveItem]) async {
    generation += 1
    let current = generation
    loading = true
    errorMessage = nil
    defer {
      if current == generation {
        loading = false
      }
    }
    do {
      let result = try await fetch()
      guard current == generation, !Task.isCancelled else { return }
      items = result
    } catch is CancellationError {
      return
    } catch {
      guard current == generation, !Task.isCancelled else { return }
      switch error {
      case let ChatServiceError.unauthorized(message), let ChatServiceError.unprocessable(_, message),
           let ChatServiceError.unexpectedResponse(message):
        errorMessage = message
      default:
        errorMessage = friendlyMessage(for: error)
      }
    }
  }
}

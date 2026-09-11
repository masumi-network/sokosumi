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
    items = []
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
    } catch {
      guard current == generation, !Task.isCancelled else { return }
      if case let ChatServiceError.unprocessable(_, message) = error {
        errorMessage = message
      } else {
        errorMessage = error.localizedDescription
      }
    }
  }
}

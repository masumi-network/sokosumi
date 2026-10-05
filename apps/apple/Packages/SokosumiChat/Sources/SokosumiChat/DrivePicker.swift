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

  /// The root crumb names whose Files these are (web `driveWorkspaceRootLabel`): "My Files" in the personal workspace,
  /// the organization's name in an organization, "Organization" while that name is unknown.
  public static func rootTitle(for workspace: WorkspaceSession.Option?) -> String {
    guard let workspace, case .organization = workspace.workspace else { return "My Files" }
    return workspace.title.isEmpty ? "Organization" : workspace.title
  }

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
      errorMessage = friendlyMessage(for: error, mode: .coreMessage)
    }
  }
}

import Combine
import CoreAPI
import Foundation
import SokosumiChat

/// Thin UI state for the SOK-973 workspace + rooms sidebar.
///
/// Behavior lives in `SokosumiChat.ChatService` (UI-free, tested); this
/// object only holds the current selection/rooms for SwiftUI and forwards
/// failures: 401 signs out via `AuthState`, other gates surface as text.
@MainActor
final class WorkspaceState: ObservableObject {
  struct WorkspaceOption: Identifiable, Hashable {
    var id: String
    var title: String
    /// Nil selects personal (org header omitted); set sends the slug.
    var slug: String?
    /// Nil selects personal; set is PUT as the preferred organization.
    var organizationId: String?
  }

  enum Phase: Equatable {
    case idle
    case loading
    case blocked(gate: Components.Schemas.WorkspaceGateStatus)
    case ready
    case failed(message: String)
  }

  @Published private(set) var phase: Phase = .idle
  @Published private(set) var options: [WorkspaceOption] = []
  @Published private(set) var selectionId: String?
  @Published private(set) var rooms: [Components.Schemas.ChatRoom] = []
  @Published private(set) var roomsLoading = false
  @Published private(set) var currentUserId = ""
  @Published private(set) var currentUserName = ""
  @Published private(set) var currentUserEmail = ""
  @Published private(set) var currentUserImageURL: String?

  private let service = ChatService()
  private let savedSelection = SavedWorkspaceSelection()
  private var hasLoaded = false

  var selection: WorkspaceOption? {
    options.first { $0.id == selectionId }
  }

  func startIfNeeded(auth: AuthState) {
    guard !hasLoaded else { return }
    hasLoaded = true
    Task { await reload(auth: auth) }
  }

  func retry(auth: AuthState) {
    Task { await reload(auth: auth) }
  }

  /// Drop everything after sign-out so the next sign-in reloads from Core.
  func reset() {
    hasLoaded = false
    phase = .idle
    options = []
    selectionId = nil
    rooms = []
    roomsLoading = false
    currentUserId = ""
    currentUserName = ""
    currentUserEmail = ""
    currentUserImageURL = nil
  }

  func select(_ option: WorkspaceOption, auth: AuthState) {
    guard option.id != selectionId else { return }
    selectionId = option.id
    savedSelection.save(option.id)
    Task { await switchRooms(auth: auth, option: option) }
  }

  private func reload(auth: AuthState) async {
    phase = .loading
    rooms = []
    guard let client = auth.coreClient() else {
      phase = .failed(message: "Sign-in is not configured.")
      return
    }
    do {
      // Read-only launch: never PUT here. Re-asserting a default preference
      // on every launch yanks cross-client state and turns a flaky upload
      // into a dead window — writes happen on explicit switches only.
      let initial = try await service.loadInitialState(client: client, savedWorkspaceId: savedSelection.load())
      currentUserId = initial.currentUser.id
      currentUserName = initial.currentUser.name
      currentUserEmail = initial.currentUser.email
      currentUserImageURL = initial.currentUser.image
      guard initial.access.gate == .ready else {
        phase = .blocked(gate: initial.access.gate)
        return
      }
      var built: [WorkspaceOption] = []
      if initial.access.hasPersonalWorkspace {
        built.append(.init(id: "personal", title: "Personal", slug: nil, organizationId: nil))
      }
      built.append(
        contentsOf: initial.organizations.map {
          .init(id: $0.id, title: $0.name, slug: $0.slug, organizationId: $0.id)
        }
      )
      options = built
      let selection = initial.defaultSelection
      selectionId = built.first { $0.organizationId == selection.organizationId }?.id
      phase = .ready
      roomsLoading = true
      defer { roomsLoading = false }
      rooms = try await service.listRooms(client: client, organizationSlug: selection.organizationSlug)
    } catch let error as ChatServiceError {
      handleServiceError(error, auth: auth, signedOutMessage: "Signed out.")
    } catch {
      NSLog("Sokosumi workspace load failed: %{public}@", String(describing: error))
      phase = .failed(message: friendlyMessage(for: error))
    }
  }

  private func switchRooms(auth: AuthState, option: WorkspaceOption) async {
    roomsLoading = true
    defer { roomsLoading = false }
    guard let client = auth.coreClient() else {
      phase = .failed(message: "Sign-in is not configured.")
      return
    }
    let selection: WorkspaceSelection =
      if let id = option.organizationId, let slug = option.slug {
        .organization(id: id, slug: slug)
      } else {
        .personal
      }
    do {
      rooms = try await service.switchWorkspace(client: client, selection: selection)
    } catch let error as ChatServiceError {
      handleServiceError(error, auth: auth, signedOutMessage: nil)
    } catch {
      NSLog("Sokosumi workspace switch failed: %{public}@", String(describing: error))
      phase = .failed(message: friendlyMessage(for: error))
    }
  }

  private func handleServiceError(_ error: ChatServiceError, auth: AuthState, signedOutMessage: String?) {
    switch error {
    case .blocked(let gate):
      phase = .blocked(gate: gate)
    case .unauthorized(let message):
      auth.signOut(message: "Core rejected the session (\(message)). Sign in again.")
      if let signedOutMessage {
        phase = .failed(message: signedOutMessage)
      }
    case .unprocessable(let statusCode, let message):
      phase = .failed(message: "Core rejected the request (\(statusCode)): \(message)")
    case .unexpectedResponse(let response):
      phase = .failed(message: "Unexpected Core response: \(response)")
    }
  }
}

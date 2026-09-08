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
    /// Single source for the org header + preference PUT: personal omits
    /// the header and PUTs null, an organization sends both. Constructed
    /// whole, so a half-filled option (id without slug) is unrepresentable.
    var workspace: WorkspaceSelection
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
  /// Switch/list failure while already `.ready`. Nil means the sidebar is fine.
  @Published private(set) var switchError: String?
  @Published private(set) var currentUserId = ""
  @Published private(set) var currentUserName = ""
  @Published private(set) var currentUserEmail = ""
  @Published private(set) var currentUserImageURL: String?

  private let service = ChatService()
  private let savedSelection: SavedWorkspaceSelection
  private var hasLoaded = false

  init(savedSelection: SavedWorkspaceSelection = SavedWorkspaceSelection()) {
    self.savedSelection = savedSelection
  }

  /// Test seam: when set, replaces `auth.coreClient()` as the client source.
  var clientResolver: (() -> Client?)?

  private func resolveClient(auth: AuthState) -> Client? {
    clientResolver?() ?? auth.coreClient()
  }

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
    switchError = nil
    currentUserId = ""
    currentUserName = ""
    currentUserEmail = ""
    currentUserImageURL = nil
    savedSelection.clear()
  }

  func select(_ option: WorkspaceOption, auth: AuthState) {
    guard option.id != selectionId else { return }
    guard !roomsLoading else { return }
    // Header + rooms commit together after the switch succeeds, so a
    // failed PUT never leaves the new header over the old rooms.
    roomsLoading = true
    Task { await switchRooms(auth: auth, option: option) }
  }

  func reload(auth: AuthState) async {
    phase = .loading
    rooms = []
    switchError = nil
    guard let client = resolveClient(auth: auth) else {
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
      var built: [WorkspaceOption] = []
      if initial.access.hasPersonalWorkspace {
        built.append(.init(id: "personal", title: "Personal", workspace: .personal))
      }
      built.append(
        contentsOf: initial.organizations.map {
          .init(id: $0.id, title: $0.name, workspace: .organization(id: $0.id, slug: $0.slug))
        }
      )
      options = built
      let selection = initial.defaultSelection
      selectionId = built.first { $0.workspace == selection }?.id
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

  func switchRooms(auth: AuthState, option: WorkspaceOption) async {
    roomsLoading = true
    defer { roomsLoading = false }
    guard let client = resolveClient(auth: auth) else {
      switchError = "Sign-in is not configured."
      return
    }
    do {
      rooms = try await service.switchWorkspace(
        client: client,
        selection: option.workspace,
        previous: selection?.workspace ?? .personal
      )
      selectionId = option.id
      savedSelection.save(option.id)
      switchError = nil
    } catch let error as ChatServiceError {
      handleServiceError(error, auth: auth, signedOutMessage: nil, keepReady: true)
    } catch {
      NSLog("Sokosumi workspace switch failed: %{public}@", String(describing: error))
      switchError = friendlyMessage(for: error)
    }
  }

  private func handleServiceError(
    _ error: ChatServiceError,
    auth: AuthState,
    signedOutMessage: String?,
    keepReady: Bool = false
  ) {
    switch error {
    case .blocked(let gate):
      phase = .blocked(gate: gate)
    case .unauthorized(let message):
      auth.signOut(message: "Core rejected the session (\(message)). Sign in again.")
      if let signedOutMessage {
        phase = .failed(message: signedOutMessage)
      }
    case .unprocessable(let statusCode, let message):
      let text = "Core rejected the request (\(statusCode)): \(message)"
      if keepReady {
        switchError = text
      } else {
        phase = .failed(message: text)
      }
    case .unexpectedResponse:
      let text = "Couldn't complete the request. Try again."
      if keepReady {
        switchError = text
      } else {
        phase = .failed(message: text)
      }
    }
  }
}

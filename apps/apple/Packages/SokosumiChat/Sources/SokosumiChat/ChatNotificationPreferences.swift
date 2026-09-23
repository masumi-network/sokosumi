import Combine
import CoreAPI
import Foundation

public typealias NotificationPreferenceCell = Components.Schemas.NotificationPreference

/// The three chat rows of web's notification matrix (Account → Notifications → Chat).
public enum ChatNotificationKind: String, CaseIterable, Identifiable, Sendable {
  case roomMessage = "CHAT_ROOM_MESSAGE"
  case mention = "CHAT_MENTION"
  case directMessage = "CHAT_DIRECT_MESSAGE"

  public var id: String {
    rawValue
  }

  var category: NotificationPreferenceCell.CategoryPayload {
    switch self {
    case .roomMessage: .chatRoomMessage
    case .mention: .chatMention
    case .directMessage: .chatDirectMessage
    }
  }
}

/// How far one kind reaches (web `Reach`). A banner carries the in-app entry
/// with it in both directions (web `withChannel`), so these three are every
/// pairing the row offers.
public enum ChatNotificationReach: String, CaseIterable, Identifiable, Sendable {
  case off
  case inApp
  case banner

  public var id: String {
    rawValue
  }

  var channels: Set<NotificationPreferenceCell.ChannelPayload> {
    switch self {
    case .off: []
    case .inApp: [.inApp]
    case .banner: [.inApp, .osBanner]
    }
  }
}

/// One situation the chat group can be in (web `PresetSpec`, Chat group).
public enum ChatNotificationPreset: String, CaseIterable, Identifiable, Sendable {
  case most
  case essential
  case appOnly
  case off

  public var id: String {
    rawValue
  }

  public func reach(for kind: ChatNotificationKind) -> ChatNotificationReach {
    switch (self, kind) {
    case (.most, .roomMessage): .inApp
    case (.most, _), (.essential, .mention), (.essential, .directMessage): .banner
    case (.appOnly, .mention), (.appOnly, .directMessage): .inApp
    default: .off
    }
  }
}

/// Account-synced chat delivery preferences: web's notification matrix cut to
/// the chat rows. Follows `ChatDisplayPreferences`: optimistic write with
/// rollback, single flight, and generation guards against stale reads and
/// results that outlive sign-out.
@MainActor
public final class ChatNotificationPreferences: ObservableObject {
  /// The whole resolved matrix as Core answered it; only chat cells are written.
  @Published public private(set) var cells: [NotificationPreferenceCell] = []
  /// Account-wide consent; Core sends no OS banner without it, whatever the cells say.
  @Published public private(set) var pushOptIn = false
  @Published public private(set) var isLoaded = false
  @Published public private(set) var isSaving = false
  private var generation = 0
  private var refreshGeneration = 0

  public init() {}

  public func reset() {
    generation += 1
    refreshGeneration += 1
    cells = []
    pushOptIn = false
    isLoaded = false
    isSaving = false
  }

  /// Kinds Core returned cells for; a kind it stops sending leaves the list.
  public var kinds: [ChatNotificationKind] {
    ChatNotificationKind.allCases.filter { kind in cells.contains { $0.category == kind.category } }
  }

  public func reach(for kind: ChatNotificationKind) -> ChatNotificationReach {
    let channels = enabledChannels(for: kind)
    if channels.contains(.osBanner) {
      return .banner
    }
    return channels.contains(.inApp) ? .inApp : .off
  }

  /// The preset whose cells match exactly, or nil for Custom. A group Core
  /// answered only part of has no preset (web `useNotificationDelivery`).
  public var preset: ChatNotificationPreset? {
    guard kinds.count == ChatNotificationKind.allCases.count else { return nil }
    return ChatNotificationPreset.allCases.first { preset in
      kinds.allSatisfy { enabledChannels(for: $0) == preset.reach(for: $0).channels }
    }
  }

  /// Any chat kind asks for a banner, so the OS answer matters.
  public var wantsBanner: Bool {
    kinds.contains { reach(for: $0) == .banner }
  }

  public func refresh(client: Client) async throws {
    refreshGeneration += 1
    let request = refreshGeneration
    let snapshot = try await ChatService().userPreferences(client: client)
    guard request == refreshGeneration, !isSaving, !Task.isCancelled else { return }
    cells = snapshot.cells
    pushOptIn = snapshot.pushOptIn
    isLoaded = true
  }

  /// What a preset writes: every kind of the group, wherever it puts them.
  public func changes(for preset: ChatNotificationPreset) -> [ChatNotificationKind: ChatNotificationReach] {
    Dictionary(uniqueKeysWithValues: kinds.map { ($0, preset.reach(for: $0)) })
  }

  /// Writes every named kind in one request, so a preset cannot land half
  /// applied. A write that leaves a banner on asks the OS first (web's
  /// moment: the press on a push cell) and records the account consent with
  /// the cells; one that leaves no banner on anywhere releases the consent
  /// (web `releasePushIfSilent`). A refused prompt still records the choice:
  /// the preference is the account's, not this Mac's.
  public func setReach(_ changes: [ChatNotificationKind: ChatNotificationReach], client: Client, authorize: () async -> Void) async throws {
    guard isLoaded, !isSaving else { return }
    let written: [NotificationPreferenceCell] = cells.compactMap { cell in
      guard let kind = ChatNotificationKind.allCases.first(where: { $0.category == cell.category }),
            let reach = changes[kind], cell.channel != .email else { return nil }
      return .init(category: cell.category, channel: cell.channel, enabled: reach.channels.contains(cell.channel))
    }
    guard written.contains(where: { change in !cells.contains(change) }) else { return }
    let previousCells = cells
    let previousOptIn = pushOptIn
    generation += 1
    refreshGeneration += 1
    let request = generation
    isSaving = true
    let asksForBanner = written.contains { $0.channel == .osBanner && $0.enabled }
    if asksForBanner {
      await authorize()
      guard request == generation else { return }
    }
    cells = cells.map { cell in written.first { $0.category == cell.category && $0.channel == cell.channel } ?? cell }
    // Asked only by a write that leaves a banner on, and released only once no
    // kind of any group is left on the banner: other groups' cells default on.
    var consent: Bool?
    if asksForBanner, !pushOptIn {
      consent = true
    } else if pushOptIn, !cells.contains(where: { $0.channel == .osBanner && $0.enabled }) {
      consent = false
    }
    pushOptIn = consent ?? pushOptIn
    do {
      let stored = try await ChatService().updateUserPreferences(
        client: client,
        pushOptIn: consent,
        notificationPreferences: written
      )
      guard request == generation else { return }
      cells = stored.cells
      pushOptIn = stored.pushOptIn
      isSaving = false
      refreshGeneration += 1
    } catch {
      guard request == generation else { return }
      cells = previousCells
      pushOptIn = previousOptIn
      isSaving = false
      refreshGeneration += 1
      throw error
    }
  }

  private func enabledChannels(for kind: ChatNotificationKind) -> Set<NotificationPreferenceCell.ChannelPayload> {
    Set(cells.filter { $0.category == kind.category && $0.enabled && $0.channel != .email }.map(\.channel))
  }
}

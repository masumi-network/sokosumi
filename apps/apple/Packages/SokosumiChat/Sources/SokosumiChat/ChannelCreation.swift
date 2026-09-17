import Combine
import Foundation

public struct ChannelRoster: Sendable {
  public let recipients: ChatRecipientRoster
  /// Organization owner/admin: may create External channels and manage channel settings.
  public let isOwnerOrAdmin: Bool

  public init(recipients: ChatRecipientRoster, isOwnerOrAdmin: Bool) {
    self.recipients = recipients
    self.isOwnerOrAdmin = isOwnerOrAdmin
  }
}

public enum ChannelCreationError: Error, Equatable, Sendable {
  case slugTaken
}

@MainActor
public final class ChannelCreation: ObservableObject {
  public enum Availability: Equatable { case invalid, checking, free, taken, failed }
  public enum Step { case details, participants }

  @Published public var draft = ChannelDraft()
  @Published public var query = ""
  @Published public private(set) var step: Step = .details
  @Published public private(set) var roster: ChannelRoster?
  @Published public private(set) var loading = false
  @Published public private(set) var creating = false
  @Published public private(set) var errorMessage: String?
  @Published public private(set) var availability: Availability = .invalid
  private var checkedSlug = ""
  private var loadGeneration = 0
  private var checkGeneration = 0

  public init() {}

  public var canAdvance: Bool {
    !loading && !creating && roster?.recipients.membersLoadFailed == false && draft.isValid
      && availability == .free && checkedSlug == draft.canonicalSlug
  }

  public var sections: [ChatRecipientSection] {
    let sections = roster?.recipients.sections(query: query) ?? []
    return [ChatRecipientSection.Kind.people, .coworkers, .assistant].compactMap { kind in sections.first { $0.id == kind } }
  }

  public func load(using fetch: () async throws -> ChannelRoster) async {
    guard !creating else { return }
    loadGeneration += 1
    let attempt = loadGeneration
    loading = true
    errorMessage = nil
    defer {
      if attempt == loadGeneration {
        loading = false
      }
    }
    do {
      let result = try await fetch()
      guard attempt == loadGeneration, !Task.isCancelled else { return }
      roster = result
      draft.recipients.formIntersection(Set(result.recipients.targets.map(\.id)))
      if !result.isOwnerOrAdmin, draft.visibility == .external {
        draft.visibility = .public
      }
    } catch {
      guard attempt == loadGeneration, !Task.isCancelled, !(error is CancellationError) else { return }
      roster = nil
      errorMessage = channelErrorMessage(error)
    }
  }

  public func checkSlug(using check: (String) async throws -> Bool) async {
    checkGeneration += 1
    let attempt = checkGeneration
    let slug = draft.canonicalSlug
    checkedSlug = ""
    guard !slug.isEmpty else { availability = .invalid
      return
    }
    availability = .checking
    do {
      let free = try await check(slug)
      guard attempt == checkGeneration, slug == draft.canonicalSlug, !Task.isCancelled else { return }
      checkedSlug = slug
      availability = free ? .free : .taken
    } catch {
      guard attempt == checkGeneration, !Task.isCancelled, !(error is CancellationError) else { return }
      availability = .failed
    }
  }

  public func advance() {
    guard canAdvance else { return }
    step = .participants
    draft.addAllMembers = true
    draft.recipients = []
    errorMessage = nil
  }

  public func back() {
    guard !creating else { return }
    step = .details
    errorMessage = nil
  }

  public func create(using submit: (ChannelDraft, ChatRecipientRoster) async throws -> Bool) async -> Bool {
    guard step == .participants, !creating, !loading, draft.isValid,
          let roster, !roster.recipients.membersLoadFailed,
          draft.visibility != .external || roster.isOwnerOrAdmin else { return false }
    creating = true
    errorMessage = nil
    defer { creating = false }
    do {
      let opened = try await submit(draft, roster.recipients)
      guard !Task.isCancelled else { return false }
      if !opened {
        errorMessage = "Couldn’t open the channel. Try again."
      }
      return opened
    } catch {
      guard !Task.isCancelled, !(error is CancellationError) else { return false }
      if error as? ChannelCreationError == .slugTaken {
        step = .details
        availability = .taken
      } else {
        errorMessage = channelErrorMessage(error)
      }
      return false
    }
  }
}

/// Core's channel messages are user-facing; everything else falls back to the shared network wording.
public func channelErrorMessage(_ error: Error) -> String {
  if case let ChatServiceError.unauthorized(message) = error {
    return message
  }
  if case let ChatServiceError.unprocessable(_, message) = error {
    return message
  }
  if case let ChatServiceError.unexpectedResponse(message) = error {
    return message
  }
  return friendlyMessage(for: error)
}

import Foundation

/// Retains the live Core provider and rejects mints from an earlier scope.
final class RealtimeTokenSource: @unchecked Sendable {
  private struct Request {
    let slug: String?
    let generation: UUID
  }

  private let lock = NSLock()
  private let provider: RealtimeTokenProvider
  private var slug: String?
  private var generation = UUID()
  private var active = true

  init(slug: String?, provider: @escaping RealtimeTokenProvider) {
    self.slug = slug
    self.provider = provider
  }

  func setSlug(_ value: String?) {
    lock.withLock {
      guard slug != value else { return }
      slug = value
      generation = UUID()
    }
  }

  func invalidate() {
    lock.withLock {
      active = false
      generation = UUID()
    }
  }

  func next() async throws -> AblyTokenFields {
    let request = lock.withLock { () -> Request? in
      guard active else { return nil }
      return Request(slug: slug, generation: generation)
    }
    guard let request else { throw CancellationError() }
    let fields = try await provider(request.slug)
    guard lock.withLock({ active && generation == request.generation }) else { throw CancellationError() }
    return fields
  }
}

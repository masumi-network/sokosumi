import Foundation
@testable import SokosumiRealtime
import Testing

private func sourceToken(_ nonce: String) -> AblyTokenFields {
  .init(keyName: "test.key", capability: "{}", timestampMillis: 1, nonce: nonce, mac: "test")
}

private actor TokenProbe {
  private(set) var slugs: [String?] = []
  private var continuation: CheckedContinuation<Void, Never>?
  private let paused: Bool

  init(paused: Bool = false) {
    self.paused = paused
  }

  func next(_ slug: String?) async -> AblyTokenFields {
    slugs.append(slug)
    if paused {
      await withCheckedContinuation { continuation = $0 }
    }
    return sourceToken("fresh")
  }

  func release() {
    continuation?.resume()
    continuation = nil
  }
}

struct RealtimeTokenSourceTests {
  @Test func everyAuthorizationUsesTheLiveProvider() async throws {
    let probe = TokenProbe()
    let source = RealtimeTokenSource(slug: nil) { await probe.next($0) }
    let first = try await source.next()
    let renewed = try await source.next()
    #expect(first.nonce == "fresh")
    #expect(renewed.nonce == "fresh")
    #expect(await probe.slugs.count == 2)
  }

  @Test func workspaceChangeRetargetsTheProvider() async throws {
    let probe = TokenProbe()
    let source = RealtimeTokenSource(slug: nil) { await probe.next($0) }
    source.setSlug("acme")
    let token = try await source.next()
    #expect(token.nonce == "fresh")
    #expect(await probe.slugs == ["acme"])
  }

  @Test(arguments: ["disconnect", "workspace"]) func staleMintCannotFinishAfterScopeChanges(change: String) async {
    let probe = TokenProbe(paused: true)
    let source = RealtimeTokenSource(slug: nil) { await probe.next($0) }
    let request = Task { try await source.next() }
    for _ in 0 ..< 1000 {
      if await !probe.slugs.isEmpty {
        break
      }
      await Task.yield()
    }
    switch change {
    case "disconnect": source.invalidate()
    default: source.setSlug("other")
    }
    await probe.release()
    do {
      _ = try await request.value
      Issue.record("Stale authorization completed")
    } catch is CancellationError {
      // The old connection/workspace cannot consume this mint.
    } catch {
      Issue.record("Unexpected error: \(error)")
    }
  }
}

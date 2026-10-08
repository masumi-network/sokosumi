import Testing

/// A fake transport was asked for more Core replies than its test scripted.
struct UnscriptedRequestError: Error {
  let operationID: String
}

/// Takes the next scripted reply. An extra request fails the test that sent it, instead of trapping in
/// `removeFirst` and killing every test running in the same process.
nonisolated func nextScriptedResponse(_ responses: inout [(Int, String)], operationID: String) throws -> (Int, String) {
  guard !responses.isEmpty else {
    Issue.record("Unscripted request \(operationID): no scripted response left")
    throw UnscriptedRequestError(operationID: operationID)
  }
  return responses.removeFirst()
}

/// Recovery timers that never fire within a test. The real 3 s fallback read lands in any test that runs longer
/// under a loaded CI runner, as an extra request the test never scripted. Tests start recovery reads explicitly.
let recoveryTimersNeverFire: (Duration) async throws -> Void = { _ in try await Task.sleep(for: .seconds(3600)) }

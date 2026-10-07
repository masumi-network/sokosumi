import CoreAPI
import Foundation
import HTTPTypes
import OpenAPIRuntime
import SokosumiChat
import Testing

@MainActor
struct MessageEditingTests {
  private func message() -> Components.Schemas.ChatRoomMessage {
    var value = chatRoomMessage(from: .init(clientTurnId: "turn", roomId: testRoomId, content: "Original",
                                            createdAt: Date(timeIntervalSince1970: 1_790_000_000),
                                            sender: .init(id: "user", name: "Ada", email: "ada@example.com", presence: .online)))
    value.id = "550e8400-e29b-41d4-a716-446655440123"
    return value
  }

  @Test func eligibilityAndCancelProtectOtherMessages() {
    var source = message()
    let editing = MessageEditing()
    editing.start(source, userId: "other")
    #expect(editing.source == nil)
    editing.start(source, userId: "user")
    #expect(editing.draft == "Original")
    #expect(!editing.canSave)
    editing.draft = "Changed"
    editing.cancel()
    #expect(editing.source == nil)
    #expect(editing.draft.isEmpty)
    source.deletedAt = Date()
    #expect(!canModifyOwnMessage(source, userId: "user"))
    source.deletedAt = nil
    source.id = "stream:turn"
    #expect(!canModifyOwnMessage(source, userId: "user"))
  }

  @Test func validationUsesTrimmedUTF16Length() {
    let editing = MessageEditing()
    editing.start(message(), userId: "user")
    for draft in ["   ", " Original ", String(repeating: "😀", count: 5001)] {
      editing.draft = draft
      #expect(!editing.canSave)
    }
    editing.draft = " \(String(repeating: "😀", count: 5000)) "
    #expect(editing.canSave)
  }

  /// Web's `handleCommit` and `canSaveEdit` (message-edit-composer.tsx): a save in flight and an over-limit
  /// draft keep editing, an empty or unchanged draft cancels, anything else saves. Both sides are trimmed.
  @Test(arguments: [
    ("Changed", "Original", false, MessageEditCommit.save),
    ("  Changed  ", "Original", false, .save),
    ("original", "Original", false, .save),
    ("Words", "", false, .save),
    (" \(String(repeating: "😀", count: 5000)) ", "Original", false, .save),
    ("Original", "Original", false, .cancel),
    ("  Original\n", "Original", false, .cancel),
    ("Original", " Original ", false, .cancel),
    ("", "Original", false, .cancel),
    (" \n\u{00A0}", "Original", false, .cancel),
    ("", "", false, .cancel),
    (String(repeating: "😀", count: 5001), "Original", false, .keepEditing),
    (String(repeating: "a", count: 10001), String(repeating: "a", count: 10001), false, .keepEditing),
    ("Changed", "Original", true, .keepEditing),
    ("Original", "Original", true, .keepEditing),
    ("", "Original", true, .keepEditing)
  ])
  func commitFollowsWebsRule(draft: String, original: String, isSaving: Bool, expected: MessageEditCommit) {
    #expect(MessageEditCommit(draft: draft, original: original, isSaving: isSaving) == expected)
  }

  /// Save is enabled exactly when a commit would save: the ✓ control and Return read one rule.
  @Test func saveIsEnabledOnlyForASavingCommit() {
    let editing = MessageEditing()
    #expect(editing.commitAction == .keepEditing, "Nothing is being edited.")
    #expect(!editing.canSave)
    editing.start(message(), userId: "user")
    for (draft, expected) in [("Original", MessageEditCommit.cancel), ("", .cancel), ("Changed", .save),
                              (String(repeating: "a", count: 10001), .keepEditing)] {
      editing.draft = draft
      #expect(editing.commitAction == expected, "\(draft.prefix(12).debugDescription)")
      #expect(editing.canSave == (expected == .save), "\(draft.prefix(12).debugDescription)")
    }
  }

  @Test(arguments: [false, true])
  func savePatchesRoomOrReplyWithoutChangingQuoteOrThread(thread: Bool) async throws {
    var source = message()
    source.parentMessageId = thread ? testRoomId : nil
    let editing = MessageEditing()
    editing.start(source, userId: "user")
    editing.draft = "  **Changed** @user  "
    let transport = TestTransport([(200, testCreatedMessageBody(id: source.id, content: "**Changed** @user", clientMessageId: "turn"))])
    let result = try await editing.save(client: makeTestClient(transport), organizationSlug: thread ? "team" : nil)
    #expect(result?.id == source.id)
    #expect(editing.source == nil)
    #expect(transport.requests[0].request.method == .patch)
    #expect(transport.requests[0].request.path?.contains("/\(source.roomId)/messages/\(source.id)") == true)
    #expect(testOrgSlugHeader(transport.requests[0].request) == (thread ? "team" : nil))
    #expect(testRequestJSON(transport.bodies[0]) as? [String: String] == ["content": "**Changed** @user"])
  }

  @Test func failedSaveRetainsDraftAndAllowsRetry() async throws {
    let editing = MessageEditing()
    let source = message()
    editing.start(source, userId: "user")
    editing.draft = "Changed"
    let transport = TestTransport([(403, "{\"message\":\"Editing denied\"}"),
                                   (200, testCreatedMessageBody(id: source.id, content: "Changed", clientMessageId: "turn"))])
    do {
      _ = try await editing.save(client: makeTestClient(transport), organizationSlug: nil)
      Issue.record("Expected a failed save")
    } catch {
      #expect(editing.source?.id == source.id)
      #expect(editing.draft == "Changed")
      #expect(editing.errorMessage != nil)
      #expect(editing.canSave)
    }
    _ = try await editing.save(client: makeTestClient(transport), organizationSlug: nil)
    #expect(editing.source == nil)
  }
}

private actor PausedEditTransport: ClientTransport {
  private var waiter: CheckedContinuation<Void, Never>?
  private var observer: CheckedContinuation<Void, Never>?

  func waitForRequest() async {
    if waiter != nil {
      return
    }
    await withCheckedContinuation { observer = $0 }
  }

  func release() {
    waiter?.resume()
    waiter = nil
  }

  func send(_: HTTPRequest, body _: HTTPBody?, baseURL _: URL, operationID _: String) async throws -> (HTTPResponse, HTTPBody?) {
    await withCheckedContinuation { waiter = $0
      observer?.resume()
      observer = nil
    }
    return (HTTPResponse(status: .ok), HTTPBody(testCreatedMessageBody(id: "source", content: "Saved", clientMessageId: "turn")))
  }
}

extension MessageEditingTests {
  @Test func lateSaveCannotRestoreEditAfterRoomChange() async throws {
    let editing = MessageEditing()
    editing.start(message(), userId: "user")
    editing.draft = "Changed"
    let transport = PausedEditTransport()
    let client = try Client.connecting(to: #require(URL(string: "https://core.example/v1")), transport: transport)
    let save = Task { try await editing.save(client: client, organizationSlug: nil) }
    await transport.waitForRequest()
    #expect(editing.isSaving)
    #expect(editing.commitAction == .keepEditing, "A commit during a save neither saves again nor cancels.")
    #expect(!editing.canSave)
    editing.cancel()
    #expect(editing.source != nil)
    editing.reset()
    editing.start(message(), userId: "user")
    editing.draft = "New room draft"
    await transport.release()
    #expect(try await save.value == nil)
    #expect(editing.draft == "New room draft")
    #expect(!editing.isSaving)
  }
}

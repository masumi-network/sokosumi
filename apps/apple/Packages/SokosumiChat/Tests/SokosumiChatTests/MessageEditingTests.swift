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

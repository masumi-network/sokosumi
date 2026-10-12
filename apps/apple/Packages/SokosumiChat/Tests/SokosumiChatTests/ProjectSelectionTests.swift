import CoreAPI
import Foundation
@testable import SokosumiChat
import Testing

/// Fixed ids for the project picker (row 38h1).
enum SelectionFixture {
  static let preview = "7d1f0c2a-0000-4000-8000-000000000007"
  static let books = "0b5e0e7a-0000-4000-8000-0000000000a1"
  static let launch = "0b5e0e7a-0000-4000-8000-0000000000a2"
  static let botSender = #"{"type":"sokoBot","sokoBot":{"id":"bot_1","name":"Soko","caption":"Me's personal assistant","image":null,"avatarSeed":"orb:user_2","ownerUserId":"user_2","presence":"online"}}"#

  /// A `project_selection` card as Core writes it: titled by Core, no status, the live options sorted by name.
  static func selectionJSON(options: String = #"[{"id":"\#(books)","name":"Books","identifier":"BOO","logo":"https://cdn.example/books.png"},{"id":"\#(launch)","name":"Launch","identifier":null,"logo":null}]"#,
                            kind: String = "project_selection") -> String {
    """
    {"id":"\(preview)","state":"available","capturedAt":"2026-10-07T14:09:00.000Z","kind":"\(kind)","title":"Choose a project",\
    "status":null,"sourceHref":"/projects","projectOptions":\(options)}
    """
  }

  /// The bot's question, answered in the Thread it was asked in.
  static func question(sender: String = botSender) async throws -> Components.Schemas.ChatRoomMessage {
    let json = testMessageJSON(id: ResultFixture.messageId, content: "Which project?", sender: sender)
      .replacingOccurrences(of: #""parentMessageId":null"#, with: #""parentMessageId":"thread-1""#)
    return try #require(await fetchTestMessages([json]).first)
  }
}

@MainActor struct ProjectSelectionTests {
  // MARK: The reply in the transcript

  @Test func webReplyReadsAsTheChosenProject() throws {
    let reply = try #require(ProjectSelectionReply(content: #"Use project "albina" (project ID: 01a09b66-77dd-740e-889e-d4ed60b6007b)."#))
    #expect(reply == ProjectSelectionReply(projectId: "01a09b66-77dd-740e-889e-d4ed60b6007b", name: "albina"))
    #expect(reply.mark.logoURL == nil)
    #expect(reply.mark.initial == "A")
    // The personal assistant's continuation keeps only the chosen project.
    let continued = #"Continue this request: "Generate a book"\#nYour question: "Which project?"\#nUse project "albina" (project ID: 01a09b66-77dd-740e-889e-d4ed60b6007b)."#
    #expect(ProjectSelectionReply(content: continued) == reply)
    // Web's regex is case-insensitive.
    #expect(ProjectSelectionReply(content: #"use PROJECT "albina" (Project id: 01A09B66-77DD-740E-889E-D4ED60B6007B)."#)?.name == "albina")
  }

  @Test func escapedNamesDecodeAsText() {
    let name = "Books \"A\" [Launch] <script>\nIdeas"
    let reply = ProjectSelectionReply(content: ProjectSelectionReply.content(projectId: SelectionFixture.books, name: name))
    #expect(reply?.name == name)
    #expect(reply?.projectId == SelectionFixture.books)
  }

  @Test(arguments: [
    "A normal chat message",
    #"Use project "albina" (project ID: 01a09b66-77dd-740e-889e-d4ed60b6007b).\#nMore text"#,
    #"More text\#nUse project "albina" (project ID: 01a09b66-77dd-740e-889e-d4ed60b6007b)."#,
    #"Continue this request: not-json\#nYour question: "Which?"\#nUse project "albina" (project ID: 01a09b66-77dd-740e-889e-d4ed60b6007b)."#,
    #"Continue this request: 1\#nYour question: "Which?"\#nUse project "albina" (project ID: 01a09b66-77dd-740e-889e-d4ed60b6007b)."#,
    #"Use project "albina" (project ID: https://evil.test)."#,
    #"Use project "" (project ID: 01a09b66-77dd-740e-889e-d4ed60b6007b)."#,
    #"Use project "  " (project ID: 01a09b66-77dd-740e-889e-d4ed60b6007b)."#,
    #"Use project "albina" (project ID: 01a09b66-77dd-740e-889e-d4ed60b6007b)"#
  ])
  func ordinaryOrMalformedMessagesStayText(content: String) {
    #expect(ProjectSelectionReply(content: content) == nil)
  }

  @Test func theReplyQuotesTheNameAsWebsJSON() {
    // `JSON.stringify('Books "A" \\ / é 😀\n\t\u0001\u001f\b\f\r')` in Node.
    #expect(ProjectSelection.json("Books \"A\" \\ / é 😀\n\t\u{01}\u{1F}\u{08}\u{0C}\r")
      == #""Books \"A\" \\ / é 😀\n\t\u0001\u001f\b\f\r""#)
    #expect(ProjectSelectionReply.content(projectId: SelectionFixture.books, name: "Books")
      == #"Use project "Books" (project ID: 0b5e0e7a-0000-4000-8000-0000000000a1)."#)
  }

  @Test func theChipLinksToTheProjectOnWeb() {
    #expect(ProjectSelection.projectURL(projectId: SelectionFixture.books, webBaseURL: ResultFixture.web)?.absoluteString
      == "https://app.example/base/projects/0b5e0e7a-0000-4000-8000-0000000000a1")
  }

  // MARK: The picker

  @Test func aSelectionCardOffersCoresLiveOptions() async throws {
    let previews = try await ResultFixture.previews([SelectionFixture.selectionJSON()])
    let items = MessageResultPreviews.items(previews, descriptorIds: [SelectionFixture.preview], webBaseURL: ResultFixture.web)
    guard case let .available(card) = items.first else {
      Issue.record("no card")
      return
    }
    #expect(card.kind == .projectSelection)
    #expect(card.projectOptions == [
      .init(id: SelectionFixture.books, mark: .init(name: "Books", logoURL: "https://cdn.example/books.png")),
      .init(id: SelectionFixture.launch, mark: .init(name: "Launch", logoURL: nil))
    ])
  }

  @Test func theSearchMatchesNamesInCoresOrder() {
    let options: [ResultPreviewCard.ProjectOption] = [
      .init(id: "1", mark: .init(name: "Books", logoURL: nil)),
      .init(id: "2", mark: .init(name: "Café Launch", logoURL: nil)),
      .init(id: "3", mark: .init(name: "Launch party", logoURL: nil))
    ]
    #expect(ProjectSelection.options(options, matching: "").map(\.id) == ["1", "2", "3"])
    #expect(ProjectSelection.options(options, matching: "  launch ").map(\.id) == ["2", "3"])
    #expect(ProjectSelection.options(options, matching: "cafe").map(\.id) == ["2"])
    #expect(ProjectSelection.options(options, matching: "zzz").isEmpty)
  }

  @Test func theReplyIdMatchesWebsForTheSameChoice() {
    // Node: web's `selectChatProjectAction` hash for the same user, room, message, card and project.
    #expect(ProjectSelection.clientMessageId(userId: "user-1", roomId: testRoomId, messageId: ResultFixture.messageId,
                                             previewId: SelectionFixture.preview, projectId: SelectionFixture.books)
        == "8d3b2e95-b535-593c-ab4d-57bcca403df0")
  }

  // MARK: Sending the pick

  @Test func aVerifiedPickRepliesToTheBotInItsThread() async throws {
    let reply = #"Use project \"Books\" (project ID: \#(SelectionFixture.books))."#
    let transport = TestTransport([
      (200, ResultFixture.body([SelectionFixture.selectionJSON()])),
      (201, testCreatedMessageBody(id: "reply-1", content: reply, clientMessageId: "x"))
    ])
    let saved = try await ChatService().selectProject(
      client: makeTestClient(transport), question: SelectionFixture.question(), previewId: SelectionFixture.preview,
      projectId: SelectionFixture.books, userId: "user-1", organizationSlug: "acme"
    )
    #expect(saved.id == "reply-1")
    #expect(transport.requests.map(\.operationID) == ["getChatRoomMessageResults", "post/chats/rooms/{id}/messages"])
    #expect(transport.requests.allSatisfy { testOrgSlugHeader($0.request) == "acme" })
    #expect(transport.requests[1].request.path?.hasSuffix("/chats/rooms/\(testRoomId)/messages") == true)
    let body = testRequestJSON(transport.bodies[1])
    #expect(body["content"] as? String == #"Use project "Books" (project ID: 0b5e0e7a-0000-4000-8000-0000000000a1)."#)
    #expect(body["mentionedSokoBotIds"] as? [String] == ["bot_1"])
    #expect(body["parentMessageId"] as? String == "thread-1")
    #expect((body["quote"] as? [String: Any])?["messageId"] as? String == ResultFixture.messageId)
    #expect(body["clientMessageId"] as? String == ProjectSelection.clientMessageId(
      userId: "user-1", roomId: testRoomId, messageId: ResultFixture.messageId, previewId: SelectionFixture.preview, projectId: SelectionFixture.books
    ))
  }

  @Test(arguments: [
    SelectionFixture.selectionJSON(options: "[]"),
    #"{"id":"\#(SelectionFixture.preview)","state":"unavailable"}"#,
    SelectionFixture.selectionJSON(kind: "task"),
    SelectionFixture.selectionJSON(options: #"[{"id":"\#(SelectionFixture.launch)","name":"Launch","identifier":null,"logo":null}]"#)
  ])
  func aRevokedRemovedOrForeignChoiceSendsNothing(result: String) async throws {
    let transport = TestTransport([(200, ResultFixture.body([result]))])
    await #expect(throws: ChatServiceError.self) {
      try await ChatService().selectProject(
        client: makeTestClient(transport), question: SelectionFixture.question(), previewId: SelectionFixture.preview,
        projectId: SelectionFixture.books, userId: "user-1", organizationSlug: nil
      )
    }
    #expect(transport.requests.map(\.operationID) == ["getChatRoomMessageResults"])
  }

  @Test func onlyABotsQuestionIsAnswered() async throws {
    let transport = TestTransport([(200, ResultFixture.body([SelectionFixture.selectionJSON()]))])
    let question = try await SelectionFixture.question(sender: testUserSender(name: "Ada", email: "ada@example.com"))
    await #expect(throws: ChatServiceError.self) {
      try await ChatService().selectProject(
        client: makeTestClient(transport), question: question, previewId: SelectionFixture.preview,
        projectId: SelectionFixture.books, userId: "user-1", organizationSlug: nil
      )
    }
    #expect(!transport.requests.contains { $0.operationID == "post/chats/rooms/{id}/messages" })
  }

  @Test func aFailedSendReachesThePicker() async throws {
    let error = #"{"error":"No","message":"Not a member","meta":{"timestamp":"\#(testTimestamp)","requestId":"req-1","path":"/x","method":"POST"}}"#
    let transport = TestTransport([(200, ResultFixture.body([SelectionFixture.selectionJSON()])), (403, error)])
    await #expect(throws: ChatServiceError.unprocessable(statusCode: 403, message: "Not a member")) {
      try await ChatService().selectProject(
        client: makeTestClient(transport), question: SelectionFixture.question(), previewId: SelectionFixture.preview,
        projectId: SelectionFixture.books, userId: "user-1", organizationSlug: nil
      )
    }
  }
}

import CoreAPI
import Foundation
@testable import SokosumiChat
import Testing

/// Row 38f: a `task` result draws web's `TaskCard` (`task-card.tsx`) from the preview's `task` object. Fixed ids and
/// times; the cards decode through the real generated client.
@MainActor struct ResultTaskCardTests {
  private static let richId = "7d1f0c2a-0000-4000-8000-000000000011"
  private static let undatedId = "7d1f0c2a-0000-4000-8000-000000000012"

  /// Every field web's card reads: a private, high-priority Task waiting for input, with manual and automatic tags,
  /// a project, an assignee who is also a participant, three more participants and comments.
  private static let richJSON = """
  {"id":"\(richId)","state":"available","capturedAt":"2026-10-07T14:07:00.000Z","kind":"task","title":"Review the draft",\
  "status":"INPUT_REQUIRED","summary":"Read it and pick the version to send.","sourceHref":"/tasks/task_1",\
  "assignee":"Ada Lovelace","project":"Launch","question":"Which version?",\
  "task":{"id":"task_1","name":"Review the draft","identifier":"LAU-7","status":"INPUT_REQUIRED","priority":"HIGH",\
  "visibility":"PRIVATE","createdAt":"2026-10-07T14:00:00.000Z","runAt":"2026-10-09T07:30:00.000Z",\
  "project":{"id":"project_1","name":"Launch","identifier":"LAU","logo":"https://cdn.example/launch.png"},\
  "assignee":{"id":"user_1","name":"Ada Lovelace","image":"https://cdn.example/ada.png","kind":"user","avatarSeed":null},\
  "participants":[{"id":"user_1","name":"Ada Lovelace","image":"https://cdn.example/ada.png","kind":"user"},\
  {"id":"user_2","name":"Grace Hopper","image":null,"kind":"user"},{"id":"user_3","name":"Alan Turing","image":null,"kind":"user"},\
  {"id":"user_4","name":" ","image":null,"kind":"user"}],"commentsCount":4,\
  "tags":{"automatic":["research","writing"],"manual":["design"],"rejected":["seo"]}}}
  """

  /// A `task` object without `createdAt`: web keeps the generic card, yet still counts the Task as shown.
  private static let undatedJSON = """
  {"id":"\(undatedId)","state":"available","capturedAt":"2026-10-07T14:07:00.000Z","kind":"task","title":"Undated",\
  "status":"READY","summary":"Still generic.","sourceHref":"/tasks/task_2","assignee":"Grace Hopper",\
  "task":{"id":"task_2","name":"Undated","identifier":null,"status":"READY","priority":"NONE","visibility":"PUBLIC",\
  "createdAt":null,"runAt":null,"project":null,"assignee":null,"participants":[],"commentsCount":0,\
  "tags":{"automatic":[],"manual":[],"rejected":[]}}}
  """

  private static func cards(_ items: [String], ids: [String]) async throws -> [ResultPreviewCard] {
    let previews = try await ResultFixture.previews(items)
    return MessageResultPreviews.items(previews, descriptorIds: ids, webBaseURL: ResultFixture.web).compactMap {
      if case let .available(card) = $0 {
        card
      } else {
        nil
      }
    }
  }

  // MARK: Which card

  @Test func aTaskResultCarriesWebsTaskCardInPlaceOfTheGenericChrome() async throws {
    let card = try #require(await Self.cards([Self.richJSON], ids: [Self.richId]).first)
    let task = try #require(card.task)
    #expect(task.id == "task_1")
    #expect(task.name == "Review the draft")
    #expect(task.identifier == "LAU-7")
    #expect(task.status == .inputRequired)
    #expect(task.priority == .high)
    #expect(task.isPrivate)
    // Manual before automatic; rejected tags never show.
    #expect(task.tags == [.design, .research, .writing])
    #expect(task.project == .init(mark: .init(name: "Launch", logoURL: "https://cdn.example/launch.png"),
                                  url: URL(string: "https://app.example/base/projects/project_1")))
    // The assignee leads and, being a participant too, is one face.
    #expect(task.actors.map(\.id) == ["user:user_1", "user:user_2", "user:user_3", "user:user_4"])
    #expect(task.actors.first == .init(id: "user:user_1", name: "Ada Lovelace", imageURL: "https://cdn.example/ada.png"))
    #expect(task.commentsCount == 4)
    #expect(task.createdAt == Date(timeIntervalSince1970: 1_791_381_600))
    #expect(task.runAt == Date(timeIntervalSince1970: 1_791_531_000))
    #expect(task.url == URL(string: "https://app.example/base/tasks/LAU-7-review-the-draft"))
    // Web's `nativeTask` hides the chip, the title's summary and the rows; the question, the source and the Task stay.
    #expect(card.status == nil)
    #expect(card.summary == nil)
    #expect(card.details.isEmpty)
    #expect(card.question == "Which version?")
    #expect(card.sourceURL == URL(string: "https://app.example/base/tasks/task_1"))
    #expect(card.taskId == "task_1")
  }

  @Test func withoutItsTaskOrItsCreationTimeATaskResultKeepsTheGenericCard() async throws {
    let cards = try await Self.cards([Self.undatedJSON, ResultFixture.bareTaskJSON], ids: [Self.undatedId, ResultFixture.bareTask])
    #expect(cards.count == 2)
    #expect(cards.allSatisfy { $0.task == nil })
    #expect(cards[0].status == .result("READY"))
    #expect(cards[0].summary == "Still generic.")
    #expect(cards[0].details == [.assignee("Grace Hopper")])
    // Web's footer still drops the Task an undated card names, and keeps one with no `task` object.
    #expect(cards.map(\.taskId) == ["task_2", nil])
  }

  /// Every other kind keeps the generic card, whatever it carries.
  @Test func onlyATaskResultDrawsTheTaskCard() async throws {
    let schedule = try #require(await Self.cards([ResultFixture.scheduleJSON], ids: [ResultFixture.schedule]).first)
    #expect(schedule.task == nil)
    #expect(schedule.status == .result("ACTIVE"))
  }

  // MARK: What the card shows

  @Test func theCardShowsTwoTagsAndThreeFacesAndCountsTheRest() async throws {
    let task = try #require(await Self.cards([Self.richJSON], ids: [Self.richId]).first?.task)
    #expect(task.visibleTags == [.design, .research])
    #expect(task.hiddenTagCount == 1)
    #expect(task.faces.map(\.name) == ["Ada Lovelace", "Grace Hopper", "Alan Turing"])
    #expect(task.hiddenFaceCount == 1)
    // A blank name reads "—", as in web's tooltip.
    #expect(task.actorNames == "Ada Lovelace, Grace Hopper, Alan Turing, —")
  }

  /// Web `TASK_STATUS_MARKERS`: hue follows the board column, weight the status inside it.
  @Test func statusTonesFollowWebsMarkers() {
    let expected: [ResultTaskCard.Status: TaskStatusTone] = [
      .draft: .init(hue: .dormant, weight: .outline), .queued: .init(hue: .staged, weight: .filled),
      .ready: .init(hue: .staged, weight: .filled), .creditsToppedUp: .init(hue: .staged, weight: .outline),
      .running: .init(hue: .active, weight: .filled), .awaitingExternal: .init(hue: .active, weight: .outline),
      .grantPending: .init(hue: .blocked, weight: .outline), .inputRequired: .init(hue: .blocked, weight: .filled),
      .approvalRequired: .init(hue: .blocked, weight: .filled), .authenticationRequired: .init(hue: .blocked, weight: .filled),
      .outOfCredits: .init(hue: .blocked, weight: .filled), .completed: .init(hue: .resolved, weight: .filled),
      .failed: .init(hue: .fault, weight: .solid), .canceled: .init(hue: .dormant, weight: .outline)
    ]
    #expect(Set(expected.keys) == Set(ResultTaskCard.Status.allCases))
    for (status, tone) in expected {
      #expect(ResultTaskCard.tone(for: status) == tone, "\(status)")
    }
  }

  // MARK: The Task's link

  private nonisolated static let sixtyAs = String(repeating: "a", count: 60)
  /// Web `taskHref` and `sanitizeChannelSlug`; the expectations are Node's output for the same names.
  private nonisolated static let hrefCases: [(String, String)] = [
    ("Review the draft", "/tasks/LAU-7-review-the-draft"),
    ("  Café Ünïcode — launch!! ", "/tasks/LAU-7-cafe-unicode-launch"),
    ("Prepare the quarterly investor update with revenue charts and churn analysis",
     "/tasks/LAU-7-prepare-the-quarterly-investor-update-with-revenue-charts"),
    // A dash right after the 60th character keeps all 60; a longer single word keeps the hard cut.
    ("\(sixtyAs) b", "/tasks/LAU-7-\(sixtyAs)"),
    ("\(sixtyAs)aaaaaaaaaa", "/tasks/LAU-7-\(sixtyAs)"),
    ("日本語", "/tasks/LAU-7"),
    ("Straße ﬁle", "/tasks/LAU-7-stra-e-file")
  ]

  @Test(arguments: hrefCases)
  func aTaskWithAnIdentifierLinksByIdentifierAndSlug(name: String, href: String) {
    #expect(ResultTaskCard.href(id: "task_1", identifier: "LAU-7", name: name) == href)
  }

  @Test func aTaskWithoutAnIdentifierLinksById() {
    #expect(ResultTaskCard.href(id: "task_1", identifier: nil, name: "Review the draft") == "/tasks/task_1")
  }

  // MARK: When it starts

  /// Web `formatRunTimeLabel` against a fixed now, 2026-10-07 14:00 UTC.
  @Test func theStartReadsLikeWebs() throws {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = try #require(TimeZone(identifier: "UTC"))
    let now = Date(timeIntervalSince1970: 1_791_381_600)
    func label(_ seconds: TimeInterval) -> TaskRunTime {
      TaskRunTime(runAt: now.addingTimeInterval(seconds), now: now, calendar: calendar)
    }
    #expect(label(0) == .overdue)
    #expect(label(-600) == .overdue)
    #expect(label(1) == .inMinutes(1))
    #expect(label(61) == .inMinutes(2))
    #expect(label(3599) == .inMinutes(60))
    #expect(label(3600) == .inHours(1))
    #expect(label(5400) == .inHours(2))
    #expect(label(86399) == .inHours(24))
    // 24 hours on is the next calendar day: tomorrow, at its clock time, through its last second.
    #expect(label(86400) == .tomorrow(now.addingTimeInterval(86400)))
    #expect(label(122_399) == .tomorrow(now.addingTimeInterval(122_399)))
    #expect(label(122_400) == .later(now.addingTimeInterval(122_400)))
  }
}

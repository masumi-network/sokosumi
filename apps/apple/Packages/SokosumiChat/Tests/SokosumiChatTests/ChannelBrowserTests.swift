import CoreAPI
import Foundation
import SokosumiChat
import Testing

@MainActor
struct ChannelBrowserTests {
  private func room(_ id: String) -> Components.Schemas.DiscoverableChatRoom {
    .init(id: id, name: id, slug: id, discoverability: ._public, memberCount: 2, createdByUserId: "me", createdAt: .distantPast, updatedAt: .distantPast)
  }

  @Test func newerSearchWinsOverLateResponse() async {
    let model = ChannelBrowser()
    model.query = "old"
    await model.search { _ in
      model.query = "new"
      await model.search { _ in [room("new")] }
      return [room("old")]
    }
    #expect(model.rooms.map(\.id) == ["new"])
    #expect(!model.loading)
  }

  @Test func failureClearsResultsAndRetryRecovers() async {
    let model = ChannelBrowser()
    await model.search { _ in [room("one")] }
    await model.search { _ in throw URLError(.notConnectedToInternet) }
    #expect(model.rooms.isEmpty)
    #expect(model.loadError == "No network connection. Check your connection and try again.")
    await model.search { _ in [room("two")] }
    #expect(model.rooms.map(\.id) == ["two"])
    #expect(model.loadError == nil)
  }

  @Test func joinBlocksDuplicateAndRetainsSearchAfterFailure() async {
    let model = ChannelBrowser()
    model.query = "team"
    await model.search { _ in [room("team")] }
    let joined = await model.join(roomId: "team") { _ in
      #expect(model.joiningRoomId == "team")
      #expect(await model.join(roomId: "other") { _ in Issue.record("Duplicate join")
        return true
      } == false)
      throw URLError(.timedOut)
    }
    #expect(!joined)
    #expect(model.joiningRoomId == nil)
    #expect(model.query == "team")
    #expect(model.rooms.map(\.id) == ["team"])
    #expect(model.joinError == "The request timed out. Please try again.")
    #expect(await model.join(roomId: "team") { _ in true })
    #expect(model.joinError == nil)
  }
}

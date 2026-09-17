import CoreAPI
import Foundation
import SokosumiChat
import Testing

@MainActor
struct ChatInvitationsTests {
  private func invitation(id: String = "inv", status: Components.Schemas.ChatRoomInvitationStatus = .pending) -> Components.Schemas.ChatRoomInvitation {
    .init(id: id, roomId: "room", roomName: "Partners", organizationId: "org", organizationName: "Acme", email: "me@example.com", status: status,
          inviter: .init(id: "host", name: "Hannah"), expiresAt: .distantFuture, createdAt: .distantPast)
  }

  @Test func pendingListKeepsCoreOrderFailsSoftAndIgnoresStaleLoads() async {
    let model = PendingInvitations()
    await model.load { [invitation(id: "b"), invitation(id: "a")] }
    #expect(model.invitations.map(\.id) == ["b", "a"])
    await model.load { throw URLError(.notConnectedToInternet) }
    #expect(model.invitations.map(\.id) == ["b", "a"])

    // A local accept/decline during a load wins over the older response.
    await model.load {
      model.remove(id: "a")
      return [invitation(id: "b"), invitation(id: "a")]
    }
    #expect(model.invitations.map(\.id) == ["b"])
    model.reset()
    #expect(model.invitations.isEmpty)
  }

  @Test func presentationFollowsWebInvitationPage() {
    #expect(InvitationPresentation(invitation()) == .pending(invitation()))
    #expect(InvitationPresentation(invitation(status: .accepted)) == .accepted(invitation(status: .accepted)))
    #expect(InvitationPresentation(invitation(status: .declined)) == .declined(invitation(status: .declined)))
    #expect(InvitationPresentation(invitation(status: .revoked)) == .revoked(invitation(status: .revoked)))
    #expect(InvitationPresentation(invitation(status: .expired)) == .expired)
  }

  @Test(arguments: [403, 404]) func invitationDetailTreatsRefusalsAsNotFound(status: Int) async {
    let model = InvitationDetail(id: "inv")
    await model.load { _ in throw ChatServiceError.unprocessable(statusCode: status, message: "Invitation not found") }
    #expect(model.presentation == .notFound)
    #expect(model.loadError == nil)
    let responded = await model.respond(.accept) { _, _ in
      Issue.record("Nothing to respond to")
      return true
    }
    #expect(!responded)
  }

  @Test func invitationDetailLoadsRespondsAndRetainsFailures() async {
    let model = InvitationDetail(id: "inv")
    await model.load { _ in throw URLError(.timedOut) }
    #expect(model.presentation == nil && model.loadError == "The request timed out. Please try again.")
    var loadedIds: [String] = []
    await model.load { id in
      loadedIds.append(id)
      return invitation()
    }
    #expect(loadedIds == ["inv"])
    #expect(model.presentation == .pending(invitation()) && model.loadError == nil && !model.loading)

    struct Call: Equatable {
      let action: InvitationAction
      let id: String
      let responding: InvitationAction?
    }
    var actions: [Call] = []
    let declined = await model.respond(.decline) { action, id in
      actions.append(Call(action: action, id: id, responding: model.responding))
      throw ChatServiceError.unprocessable(statusCode: 400, message: "Invitation is no longer pending.")
    }
    #expect(!declined)
    #expect(model.responseError == "Invitation is no longer pending." && model.responding == nil)
    #expect(model.presentation == .pending(invitation()))
    let accepted = await model.respond(.accept) { action, id in
      actions.append(Call(action: action, id: id, responding: model.responding))
      return true
    }
    #expect(accepted && model.responseError == nil)
    #expect(actions == [Call(action: .decline, id: "inv", responding: .decline), Call(action: .accept, id: "inv", responding: .accept)])
  }

  @Test func guestJoinResolvesPreviewAndJoins() async {
    let model = GuestJoin(token: "tok")
    await model.resolve { _ in throw URLError(.notConnectedToInternet) }
    #expect(model.loadError == "No network connection. Check your connection and try again." && model.room == nil)
    let unresolved = await model.join { _ in
      Issue.record("Unresolved links cannot be joined")
      return true
    }
    #expect(!unresolved)

    await model.resolve { _ in .init(status: .expired, room: nil) }
    #expect(model.link?.status == .expired && model.room == nil && model.loadError == nil)

    var resolvedTokens: [String] = []
    await model.resolve { token in
      resolvedTokens.append(token)
      return .init(status: .valid, room: .init(id: "room", name: "Partners", organizationId: "org", organizationName: "Acme"))
    }
    #expect(resolvedTokens == ["tok"] && model.room?.name == "Partners")
    let depleted = await model.join { _ in throw ChatServiceError.unprocessable(statusCode: 400, message: "This invite link has reached its usage limit.") }
    #expect(!depleted && model.joinError == "This invite link has reached its usage limit." && !model.joining)
    // A stale-context join settles quietly and re-enables the button.
    let stale = await model.join { _ in false }
    #expect(!stale && model.joinError == nil && !model.joining)
    // Web keeps "Joining…" after success until navigation replaces the page.
    var joinedTokens: [(String, Bool)] = []
    let joined = await model.join { token in
      joinedTokens.append((token, model.joining))
      return true
    }
    #expect(joined && model.joining)
    #expect(joinedTokens.map(\.0) == ["tok"] && joinedTokens.map(\.1) == [true])
  }
}

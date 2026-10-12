#if os(macOS)
  import AppKit
  import CoreAPI
  import OpenAPIRuntime
  @testable import Sokosumi
  import SokosumiChat
  import SwiftUI
  import Testing

  /// Answers the row's reads in turn and holds each resolution open until the test answers it.
  @MainActor private final class DecisionGate {
    var answers: [[Components.Schemas.ChatResultPreview]] = []
    private(set) var reads = 0
    private(set) var resolutions: [[String]] = []
    var failure: (any Error)?
    private var waiter: CheckedContinuation<Void, Never>?

    func load() async throws -> [Components.Schemas.ChatResultPreview] {
      reads += 1
      return answers.count > 1 ? answers.removeFirst() : answers[0]
    }

    func resolve(_ decisionId: String, _ resolution: SokoBotDecision.Resolution) async throws {
      resolutions.append([decisionId, resolution.rawValue])
      await withCheckedContinuation { waiter = $0 }
      if let failure {
        self.failure = nil
        throw failure
      }
    }

    func release() {
      waiter?.resume()
      waiter = nil
    }
  }

  /// The result-card suite's hosting, waiting and accessibility helpers.
  private typealias Helpers = NativeWindowTests.SokoBotResultPreviewsTests

  extension NativeWindowTests {
    /// Row 38h2: a Soko Bot's decision card (web `DecisionCard` in `ResultPreviews`, #5806): what the bot wants to do
    /// and why, Approve / Reject while it waits, the settled status afterwards. Words and controls come from the
    /// hosted views' accessibility nodes.
    @MainActor struct DecisionCardViewTests {
      private static let created = Date(timeIntervalSince1970: 1_791_381_900)
      private static let expires = Date(timeIntervalSince1970: 1_791_471_600)
      private static let preview = "7d1f0c2a-0000-4000-8000-000000000008"
      private static let decision = "3c4d5e6f-0000-4000-8000-0000000000d1"
      private static let reason = "Hire Scout to research launch risks before Friday."
      private static let hire: [String: any Sendable] = [
        "agentId": "agent_123", "maxCredits": 25, "name": "Launch research",
        "inputData": ["brief": "Research launch risks", "depth": 2] as [String: any Sendable],
        "inputSchema": ["type": "object"] as [String: any Sendable]
      ]

      private static func result(
        _ status: Components.Schemas.ChatResultAvailable.DecisionPayload.StatusPayload = .pending,
        toolName: String = "hire_agent", proposal: [String: any Sendable] = hire
      ) throws -> Components.Schemas.ChatResultPreview {
        try .available(.init(
          id: preview, state: .available, capturedAt: created, kind: .decision, title: reason, status: status.rawValue, summary: reason,
          sourceHref: "/personal-assistant",
          decision: .init(id: decision, turnId: "3c4d5e6f-0000-4000-8000-0000000000e1", toolName: toolName,
                          proposal: .init(additionalProperties: proposal.mapValues { try OpenAPIValueContainer(unvalidatedValue: $0) }),
                          reason: reason, status: status, expiresAt: expires, resolvedAt: nil, resultingEntityId: nil,
                          createdAt: created, updatedAt: created)
        ))
      }

      private static func card(_ result: Components.Schemas.ChatResultPreview) -> ResultPreviewItem {
        MessageResultPreviews.items([result], descriptorIds: [preview], webBaseURL: CoreSettings.webBaseURL)[0]
      }

      private static var expiry: String {
        "Expires \(TimeFormatPreference.auto.shortDateTime(expires))"
      }

      private static func isEnabled(_ label: String, in host: NSView) async -> Bool? {
        guard let node = await Helpers.nodes(labelled: label, in: host).first else { return nil }
        return (node.object.value(forKey: "accessibilityEnabled") as? Bool) ?? true
      }

      // MARK: Pending

      /// Web: the heading and the tool's label, the reason, the proposal's typed fields and its masked rest, then
      /// Approve, Reject and the expiry; none of the generic card's title, status or source link.
      @Test func aPendingDecisionShowsWhatTheBotWantsAndBothActions() async throws {
        let card = try ResultPreviewCardView(item: Self.card(Self.result()), resolveDecision: { _, _ in })
        let (window, host) = Helpers.window(card.padding(12), size: NSSize(width: 620, height: 360))
        defer { window.orderOut(nil) }
        let texts = try await Helpers.waitForText("Needs your okay", in: host)
        for text in ["Hiring an agent", Self.reason, "Agent", "agent_123", "Max credits", "25", "Name", "Launch research", "Input",
                     "brief: Research launch risks · depth: 2", "inputSchema: type: object", Self.expiry] {
          #expect(texts.contains(text), "\(text) missing from \(texts)")
        }
        #expect(!texts.contains { $0.hasPrefix("Open source") || $0 == "Approval" || $0 == "Pending" }, "\(texts)")
        #expect(await Self.isEnabled("Approve", in: host) == true)
        #expect(await Self.isEnabled("Reject", in: host) == true)
      }

      /// Web: a hire without an Agent or a positive ceiling says so and cannot be approved; Reject stays.
      @Test func anIncompleteHireCannotBeApproved() async throws {
        let card = try ResultPreviewCardView(item: Self.card(Self.result(proposal: ["agentId": "agent_123"])), resolveDecision: { _, _ in })
        let (window, host) = Helpers.window(card.padding(12), size: NSSize(width: 620, height: 300))
        defer { window.orderOut(nil) }
        _ = try await Helpers.waitForText(
          "This hire proposal is missing an Agent or a positive credit ceiling; it cannot be accepted.", in: host
        )
        #expect(await Self.isEnabled("Approve", in: host) == false)
        #expect(await Self.isEnabled("Reject", in: host) == true)
      }

      /// Web `useToolLabel`: a tool web does not name reads as its own name; a proposal without typed fields shows
      /// all of it on one masked line.
      @Test func anUnknownToolReadsItsNameAndItsWholeProposal() async throws {
        let card = try ResultPreviewCardView(item: Self.card(Self.result(
          toolName: "send_slack_message", proposal: ["channel": "#launch", "text": "Ship it", "apiToken": "xoxb-1"]
        )), resolveDecision: { _, _ in })
        let (window, host) = Helpers.window(card.padding(12), size: NSSize(width: 620, height: 300))
        defer { window.orderOut(nil) }
        let texts = try await Helpers.waitForText("send slack message", in: host)
        #expect(texts.contains("apiToken: ••• · channel: #launch · text: Ship it"), "\(texts)")
        #expect(!texts.contains { $0.contains("xoxb-1") })
      }

      // MARK: Resolving

      /// Web: a press disables both buttons until Core answers, then the row reads its results again and the card
      /// shows the settled decision.
      @Test func approvingResolvesAndTheRowRereadsTheSettledCard() async throws {
        let gate = DecisionGate()
        gate.answers = try [[Self.result()], [Self.result(.accepted)]]
        let row = MessageResultPreviewsView(descriptorIds: [Self.preview], footer: nil, load: { try await gate.load() },
                                            resolveDecision: { try await gate.resolve($0, $1) })
        let (window, host) = Helpers.window(row.padding(12), size: NSSize(width: 620, height: 360))
        defer { window.orderOut(nil) }
        _ = try await Helpers.waitForText("Needs your okay", in: host)
        #expect(try #require(await Helpers.nodes(labelled: "Approve", in: host).first).press())
        await Helpers.settle(host)
        #expect(gate.resolutions == [[Self.decision, "ACCEPT"]])
        #expect(await Self.isEnabled("Approve", in: host) == false)
        #expect(await Self.isEnabled("Reject", in: host) == false)
        gate.release()
        let texts = try await Helpers.waitForText("Approved and carried out.", in: host)
        #expect(texts.contains("Approval") && !texts.contains("Needs your okay") && !texts.contains(Self.expiry), "\(texts)")
        #expect(await Helpers.nodes(labelled: "Approve", in: host).isEmpty)
        #expect(gate.reads == 2)
        #expect(gate.resolutions.count == 1)
      }

      /// Web toasts Core's message; the app says so in an alert, reads nothing again and keeps both buttons.
      @Test func aRefusedResolutionSaysSoAndKeepsTheButtons() async throws {
        let gate = DecisionGate()
        gate.answers = try [[Self.result()]]
        gate.failure = ChatServiceError.unprocessable(statusCode: 409, message: "Pending decision expired")
        let row = MessageResultPreviewsView(descriptorIds: [Self.preview], footer: nil, load: { try await gate.load() },
                                            resolveDecision: { try await gate.resolve($0, $1) })
        let (window, host) = Helpers.window(row.padding(12), size: NSSize(width: 620, height: 360))
        defer { window.orderOut(nil) }
        _ = try await Helpers.waitForText("Needs your okay", in: host)
        #expect(try #require(await Helpers.nodes(labelled: "Reject", in: host).first).press())
        await Helpers.settle(host)
        #expect(gate.resolutions == [[Self.decision, "REJECT"]])
        gate.release()
        let deadline = ContinuousClock.now.advanced(by: .seconds(10))
        while window.attachedSheet == nil, ContinuousClock.now < deadline {
          try await Task.sleep(for: .milliseconds(25))
        }
        let sheet = try #require(window.attachedSheet)
        let alert = try await hostedTexts(in: #require(sheet.contentView))
        #expect(alert.contains("Could not resolve the approval.") && alert.contains("Pending decision expired"), "\(alert)")
        window.endSheet(sheet)
        await Helpers.settle(host)
        #expect(gate.reads == 1)
        #expect(await Self.isEnabled("Approve", in: host) == true)
        #expect(await Self.isEnabled("Reject", in: host) == true)
      }

      // MARK: Settled

      /// Web `DecisionExplain`: a settled decision explains its status in place of the buttons and the expiry.
      @Test(arguments: [
        (Components.Schemas.ChatResultAvailable.DecisionPayload.StatusPayload.processing,
         "Being carried out. If this is an Agent hire, the seller-side start is in flight or unconfirmed — do not resubmit; "
           + "it resolves automatically or an operator will follow up."),
        (.accepted, "Approved and carried out."),
        (.rejected, "Rejected. Nothing was created."),
        (.expired, "Expired without a decision. Ask your Soko Bot again if still needed.")
      ])
      func aSettledDecisionExplainsItsStatus(status: Components.Schemas.ChatResultAvailable.DecisionPayload.StatusPayload,
                                             explanation: String) async throws {
        let card = try ResultPreviewCardView(item: Self.card(Self.result(status)), resolveDecision: { _, _ in })
        let (window, host) = Helpers.window(card.padding(12), size: NSSize(width: 620, height: 320))
        defer { window.orderOut(nil) }
        let texts = try await Helpers.waitForText(explanation, in: host)
        #expect(texts.contains("Approval") && texts.contains("Hiring an agent"), "\(texts)")
        #expect(!texts.contains(Self.expiry) && !texts.contains("Needs your okay"), "\(texts)")
        #expect(await Helpers.nodes(labelled: "Approve", in: host).isEmpty)
        #expect(await Helpers.nodes(labelled: "Reject", in: host).isEmpty)
      }

      // MARK: Render

      /// Light beside dark: a pending hire with its fields and the rest of its proposal, an incomplete hire, an
      /// approved and an expired decision, each hosted over the window background.
      @Test func rendersTheDecisionCards() async throws {
        var columns: [[CGImage]] = []
        for dark in [false, true] {
          try await columns.append([
            Helpers.draw(ResultPreviewCardView(item: Self.card(Self.result()), resolveDecision: { _, _ in }).padding(12),
                         size: NSSize(width: 640, height: 252), dark: dark, until: "Needs your okay"),
            Helpers.draw(ResultPreviewCardView(item: Self.card(Self.result(proposal: ["agentId": "agent_123", "name": "Launch research"])),
                                               resolveDecision: { _, _ in }).padding(12),
                         size: NSSize(width: 640, height: 216), dark: dark,
                         until: "This hire proposal is missing an Agent or a positive credit ceiling; it cannot be accepted."),
            Helpers.draw(ResultPreviewCardView(item: Self.card(Self.result(.accepted)), resolveDecision: { _, _ in }).padding(12),
                         size: NSSize(width: 640, height: 240), dark: dark, until: "Approved and carried out."),
            Helpers.draw(ResultPreviewCardView(item: Self.card(Self.result(.expired, toolName: "create_task", proposal: [
              "name": "Draft the launch post", "status": "READY", "coworkerId": "cw_42"
            ])), resolveDecision: { _, _ in }).padding(12),
            size: NSSize(width: 640, height: 196), dark: dark, until: "Expired without a decision. Ask your Soko Bot again if still needed.")
          ])
        }
        let combined = try RoomHeaderTests.stitched(columns)
        try Attachment.record(#require(combined.representation(using: .png, properties: [:])), named: "soko-bot-decision-card.png")
      }
    }
  }
#endif

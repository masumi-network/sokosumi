#if os(macOS)
  import AppKit
  import CoreAPI
  @testable import Sokosumi
  import SokosumiAuth
  import SokosumiChat
  import SokosumiWorkspace
  import SwiftUI
  import Testing

  /// Holds the attached skills in `@State`, as `ChatComposerView` does.
  private struct SkillsComposerHost: View {
    @State private var skills: [Components.Schemas.ChatRoomMessageSkill]
    @State private var draft = "Review the launch plan"

    init(skills: [Components.Schemas.ChatRoomMessageSkill]) {
      _skills = State(initialValue: skills)
    }

    var body: some View {
      var input = ComposerTextInput(text: $draft, submit: { false }, placeholder: "Message #launch")
      input.skills = ComposerSkills(selected: skills, search: { _ in [] }, change: { skills = $0 })
      return input
    }
  }

  /// One of SwiftUI's accessibility nodes, driven the way VoiceOver drives it.
  struct AccessibilityNode {
    let object: NSObject

    var isEnabled: Bool {
      (object.value(forKey: "accessibilityEnabled") as? Bool) ?? true
    }

    func press() -> Bool {
      let selector = NSSelectorFromString("accessibilityPerformPress")
      guard object.responds(to: selector) else { return false }
      typealias Press = @convention(c) (NSObject, Selector) -> Bool
      return unsafeBitCast(object.method(for: selector), to: Press.self)(object, selector)
    }
  }

  /// One composer the skill button is checked in: a room, the Thread it may be in, and whether skills are offered.
  private struct SkillsComposerCase {
    let room: Components.Schemas.ChatRoom
    var parent: String?
    let offered: Bool
  }

  extension NativeWindowTests {
    /// Row 42: skills.sh skills on chat messages. The composer's skill button beside Emoji where an agent reads the
    /// send, its chips, the picker's rows and states, and the chips under a sent message with their preview. Words
    /// and controls are read from the hosted view's accessibility nodes, never from pixels.
    @MainActor struct ComposerSkillsTests {
      private static let created = Date(timeIntervalSince1970: 1_790_000_000)
      private static let viewer = Components.Schemas.ChatRoomUserParticipant(id: "me", name: "Me", email: "me@example.com", presence: .online)
      private static let peer = Components.Schemas.ChatRoomUserParticipant(id: "peer", name: "Peer", email: "peer@example.com", presence: .online)
      private static let coworker = Components.Schemas.ChatRoomCoworkerParticipant(id: "cow", name: "Helper", slug: "helper", presence: .online)

      private static let react = Components.Schemas.ChatSkillCatalogItem(
        id: "vercel-labs/agent-skills/react", name: "react", source: "vercel-labs/agent-skills", description: "React rules", installs: 1200
      )
      private static let grill = Components.Schemas.ChatSkillCatalogItem(
        id: "mattpocock/skills/grill-me", name: "grill-me", source: "mattpocock/skills", description: nil, installs: 761_642
      )

      private static func skill(_ index: Int, description: String? = nil) -> Components.Schemas.ChatRoomMessageSkill {
        .init(id: "a/b/skill-\(index)", name: "skill-\(index)", description: description, url: "https://skills.sh/a/b/skill-\(index)")
      }

      private static func room(_ id: String, kind: Components.Schemas.ChatRoom.KindPayload, users: [Components.Schemas.ChatRoomUserParticipant],
                               coworkers: [Components.Schemas.ChatRoomCoworkerParticipant]) -> Components.Schemas.ChatRoom {
        .init(
          id: id, name: "launch", kind: kind, isSelfDirect: false, isGroupDirect: false, isReadOnly: false,
          discoverability: .external, createdByUserId: "me", createdAt: created, updatedAt: created, unreadCount: 0,
          unreadMentionCount: 0, markedUnread: false, myAccess: .init(value1: .member, value2: "member"),
          userMembers: users, formerUserMembers: [], coworkerMembers: coworkers, sokoBotMembers: []
        )
      }

      // MARK: The button

      /// Web `shouldAllowRoomSkills`: a Channel with a coworker (and its Threads) offers skills; a Channel of people
      /// only and the coworker 1:1, whose stream send carries none, do not.
      @Test func theSkillButtonShowsOnlyWhereAnAgentReadsTheSend() async {
        let cases: [SkillsComposerCase] = [
          .init(room: Self.room("skills-agent", kind: .channel, users: [Self.viewer, Self.peer], coworkers: [Self.coworker]), offered: true),
          .init(room: Self.room("skills-agent-thread", kind: .channel, users: [Self.viewer, Self.peer], coworkers: [Self.coworker]),
                parent: "parent", offered: true),
          .init(room: Self.room("skills-people", kind: .channel, users: [Self.viewer, Self.peer], coworkers: []), offered: false),
          .init(room: Self.room("skills-stream", kind: .direct, users: [Self.viewer], coworkers: [Self.coworker]), offered: false)
        ]
        for testCase in cases {
          let (room, parent, offered) = (testCase.room, testCase.parent, testCase.offered)
          let userId = UUID().uuidString
          let state = WorkspaceState()
          state.rooms = [room]
          let saved = SavedComposeDraft(userId: userId, organizationId: nil, roomId: room.id, parentMessageId: parent)
          defer { saved.save("") }
          let content = ChatComposerView(userId: userId, organizationId: nil, roomId: room.id, parentMessageId: parent)
            .environmentObject(state).environmentObject(AuthState())
            .environmentObject(ComposeUploads(savedDraft: saved)).environmentObject(ComposerAttachmentIngress())
          let (window, host) = Self.window(content, size: NSSize(width: 520, height: 160))
          defer { window.orderOut(nil) }
          await Self.settle(host)
          let texts = await hostedTexts(in: host)
          #expect(texts.contains("Emoji & Symbols"), "\(room.id): \(texts)")
          #expect(texts.contains("Add a skill") == offered, "\(room.id): \(texts)")
        }
      }

      /// Web `ComposerSkillChips`: each attached skill above the editor with its own Remove; removing one leaves the rest.
      @Test func attachedSkillsShowAsChipsThatRemoveOneByOne() async throws {
        let (window, host) = Self.window(SkillsComposerHost(skills: [Self.skill(1), Self.skill(2)]), size: NSSize(width: 520, height: 180))
        defer { window.orderOut(nil) }
        await Self.settle(host)
        var texts = await hostedTexts(in: host)
        #expect(texts.contains("skill-1") && texts.contains("skill-2"), "\(texts)")
        let remove = try #require(await Self.element(labelled: "Remove skill-1", in: host), "\(texts)")
        #expect(remove.press())
        await Self.settle(host)
        texts = await hostedTexts(in: host)
        #expect(!texts.contains("skill-1") && texts.contains("skill-2"), "\(texts)")
      }

      /// Web: the button is disabled at `MAX_SKILLS_PER_MESSAGE`.
      @Test func theButtonStopsAtThreeSkills() async throws {
        let (window, host) = Self.window(SkillsComposerHost(skills: [Self.skill(1), Self.skill(2)]), size: NSSize(width: 520, height: 180))
        defer { window.orderOut(nil) }
        await Self.settle(host)
        let open = try #require(await Self.element(labelled: "Add a skill", in: host))
        #expect(open.isEnabled)

        let (fullWindow, fullHost) = Self.window(SkillsComposerHost(skills: [Self.skill(1), Self.skill(2), Self.skill(3)]),
                                                 size: NSSize(width: 520, height: 180))
        defer { fullWindow.orderOut(nil) }
        await Self.settle(fullHost)
        let full = try #require(await Self.element(labelled: "Add a skill", in: fullHost))
        #expect(!full.isEnabled)
      }

      // MARK: The picker

      /// Web's rows: the name, the compact install count, the description or else the source; an attached skill is
      /// marked Added and cannot be picked. Pressing a row picks it.
      @Test func thePickerListsTheTopSkillsAndPicksOne() async throws {
        var picked: [String] = []
        let picker = SkillPickerView(attached: [Self.react.id], search: { _ in [Self.react, Self.grill] }, pick: { picked.append($0.id) })
        let (window, host) = Self.window(picker, size: NSSize(width: 320, height: 260))
        defer { window.orderOut(nil) }
        _ = try await Self.waitForText("grill-me", in: host)
        // A row speaks its parts as one label joined by ", "; keep each part too.
        let texts = await hostedTexts(in: host).flatMap { [$0] + $0.components(separatedBy: ", ") }
        for text in ["Search skills", "react", "1.2K installs", "React rules", "grill-me", "762K installs", "mattpocock/skills", "Added"] {
          #expect(texts.contains(text), "\(text) missing from \(texts)")
        }
        let attached = try #require(await Self.element(containing: "react", in: host))
        #expect(!attached.isEnabled)
        let row = try #require(await Self.element(containing: "grill-me", in: host))
        #expect(row.press())
        #expect(picked == [Self.grill.id])
      }

      /// Return in the search field picks the first skill not yet attached (web `firstPickable`).
      @Test func returnPicksTheFirstSkillNotYetAttached() async throws {
        var picked: [String] = []
        let picker = SkillPickerView(attached: [Self.react.id], search: { _ in [Self.react, Self.grill] }, pick: { picked.append($0.id) })
        let (window, host) = Self.window(picker, size: NSSize(width: 320, height: 260))
        defer { window.orderOut(nil) }
        _ = try await Self.waitForText("grill-me", in: host)
        let field = try #require(Self.textField(in: host))
        field.sendAction(field.action, to: field.target)
        await Self.settle(host)
        #expect(picked == [Self.grill.id])
      }

      @Test func eachEmptyPickerSaysWhy() async throws {
        let cases: [(String, (String) async throws -> [Components.Schemas.ChatSkillCatalogItem])] = [
          ("Skills could not be loaded. Try again.", { _ in throw ChatServiceError.unexpectedResponse("down") }),
          ("No skills found", { _ in [] }),
          ("Loading skills…", { _ in try await Task.sleep(for: .seconds(30))
            return [] })
        ]
        for (expected, search) in cases {
          let (window, host) = Self.window(SkillPickerView(attached: [], search: search) { _ in }, size: NSSize(width: 320, height: 200))
          defer { window.orderOut(nil) }
          _ = try await Self.waitForText(expected, in: host)
        }
      }

      // MARK: The sent message

      /// Web `MessageSkillChips` under the body, and its preview: the kicker, the name, the description and
      /// "View on skills.sh" opening the skill's page.
      @Test func aSentMessageShowsItsSkillsAndPreviewsOne() async throws {
        var message = chatRoomMessage(from: .init(clientTurnId: "sent", roomId: "room", content: "Grill this plan.",
                                                  skills: [Self.skill(1, description: "A relentless interview.")], createdAt: Self.created, sender: Self.viewer))
        message.id = "sent"
        let (window, host) = Self.window(MessageRowView(message: message, isContinuation: false, outbound: nil, onRetry: nil, onRemove: nil),
                                         size: NSSize(width: 520, height: 140))
        defer { window.orderOut(nil) }
        _ = try await Self.waitForText("Skill: skill-1", in: host)

        var opened: [URL] = []
        let preview = MessageSkillPreview(skill: Self.skill(1, description: "A relentless interview."))
          .environment(\.openURL, OpenURLAction { opened.append($0)
            return .handled
          })
        let (previewWindow, previewHost) = Self.window(preview, size: NSSize(width: 300, height: 160))
        defer { previewWindow.orderOut(nil) }
        await Self.settle(previewHost)
        let texts = await hostedTexts(in: previewHost)
        for text in ["Skill from skills.sh, sent to the agents this message reaches", "skill-1", "A relentless interview."] {
          #expect(texts.contains(text), "\(text) missing from \(texts)")
        }
        let link = try #require(await Self.element(containing: "View on skills.sh", in: previewHost), "\(texts)")
        #expect(link.press())
        await Self.settle(previewHost)
        #expect(opened == [URL(string: "https://skills.sh/a/b/skill-1")])
      }

      // MARK: Render

      /// Light beside dark: the composer with two chips, the open picker, and a sent message with its skill chips over
      /// its preview, each hosted over the window background.
      @Test func rendersTheComposerThePickerAndASentMessage() async throws {
        var columns: [[CGImage]] = []
        for dark in [false, true] {
          var message = chatRoomMessage(from: .init(clientTurnId: "render", roomId: "room", content: "Can you grill this launch plan?",
                                                    skills: [Self.skill(1), .init(id: "vercel-labs/agent-skills/react", name: "react",
                                                                                  description: "React rules", url: "https://skills.sh/vercel-labs/agent-skills/react")],
                                                    createdAt: Self.created, sender: Self.viewer))
          message.id = "render"
          let composer = SkillsComposerHost(skills: [MessageSkills.chip(for: Self.grill), MessageSkills.chip(for: Self.react)])
          let picker = SkillPickerView(attached: [Self.grill.id, Self.react.id], search: { _ in
            [Self.react, Self.grill, .init(id: "anthropics/skills/pdf", name: "pdf", source: "anthropics/skills",
                                           description: "Read, fill and merge PDF files.", installs: 48300)]
          }, pick: { _ in })
          try await columns.append([
            Self.draw(composer.padding(12), size: NSSize(width: 560, height: 190), dark: dark),
            // As the popover draws it: the panel on its own rounded surface.
            Self.draw(picker
              .background(.background, in: .rect(cornerRadius: 10))
              .overlay { RoundedRectangle(cornerRadius: 10).stroke(.quaternary) }
              .padding(12), size: NSSize(width: 560, height: 280), dark: dark, until: "pdf"),
            Self.draw(VStack(alignment: .leading, spacing: 12) {
              MessageRowView(message: message, isContinuation: false, outbound: nil, onRetry: nil, onRemove: nil)
              MessageSkillPreview(skill: Self.skill(1, description: "A relentless interview to sharpen a plan."))
                .background(.background, in: .rect(cornerRadius: 10))
                .overlay { RoundedRectangle(cornerRadius: 10).stroke(.quaternary) }
                .padding(.leading, 48)
            }.padding(12), size: NSSize(width: 560, height: 280), dark: dark, until: "Skill: skill-1")
          ])
        }
        let combined = try RoomHeaderTests.stitched(columns)
        try Attachment.record(#require(combined.representation(using: .png, properties: [:])), named: "chat-message-skills.png")
      }

      // MARK: Helpers

      static func window(_ content: some View, size: NSSize) -> (NSWindow, NSView) {
        let host = NSHostingView(rootView: content.frame(width: size.width, height: size.height).background(.background)
          .environment(\.locale, Locale(identifier: "en_US")))
        let window = NSWindow(contentRect: NSRect(origin: .zero, size: size), styleMask: [.titled], backing: .buffered, defer: false)
        window.contentView = host
        window.orderFront(nil)
        return (window, host)
      }

      static func draw(_ content: some View, size: NSSize, dark: Bool, until text: String? = nil) async throws -> CGImage {
        let host = NSHostingView(rootView: content
          .frame(width: size.width, height: size.height, alignment: .topLeading)
          .background(.background)
          .environment(\.locale, Locale(identifier: "en_US"))
          .environment(\.colorScheme, dark ? .dark : .light))
        let window = NSWindow(contentRect: NSRect(origin: .zero, size: size), styleMask: [.titled], backing: .buffered, defer: false)
        window.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        window.ignoresMouseEvents = true
        window.contentView = host
        window.orderFront(nil)
        defer { window.orderOut(nil) }
        if let text {
          _ = try await waitForText(text, in: host)
        }
        await settle(host)
        let bitmap = try #require(host.bitmapImageRepForCachingDisplay(in: host.bounds))
        host.cacheDisplay(in: host.bounds, to: bitmap)
        try CreateChannelGuidanceTests.expectWindowBackground(bitmap, dark: dark)
        return try #require(bitmap.cgImage)
      }

      static func settle(_ host: NSView) async {
        for _ in 0 ..< 8 {
          await Task.yield()
          host.layoutSubtreeIfNeeded()
          try? await Task.sleep(for: .milliseconds(25))
        }
      }

      static func waitForText(_ text: String, in host: NSView) async throws -> [String] {
        let deadline = ContinuousClock.now.advanced(by: .seconds(10))
        var texts: [String] = []
        repeat {
          host.layoutSubtreeIfNeeded()
          texts = await hostedTexts(in: host)
          if texts.contains(where: { $0 == text || $0.components(separatedBy: ", ").contains(text) }) {
            return texts
          }
          try await Task.sleep(for: .milliseconds(25))
        } while ContinuousClock.now < deadline
        Issue.record("\"\(text)\" never showed: \(texts)")
        return texts
      }

      /// The accessibility node whose label is exactly `label`.
      static func element(labelled label: String, in host: NSView) async -> AccessibilityNode? {
        await element(in: host) { $0 == label }
      }

      /// The first accessibility node, parents before children, whose label is `text` or has it as one of its
      /// ", "-joined parts (a button speaks its children as one label).
      static func element(containing text: String, in host: NSView) async -> AccessibilityNode? {
        await element(in: host) { $0 == text || $0.components(separatedBy: ", ").contains(text) }
      }

      static func element(in host: NSView, where matches: (String) -> Bool) async -> AccessibilityNode? {
        _ = await hostedTexts(in: host)
        var seen: Set<ObjectIdentifier> = []
        func find(_ element: Any) -> AccessibilityNode? {
          guard let object = element as? NSObject, seen.insert(ObjectIdentifier(object)).inserted else { return nil }
          if object.responds(to: NSSelectorFromString("accessibilityLabel")),
             let label = object.value(forKey: "accessibilityLabel") as? String, matches(label) {
            return AccessibilityNode(object: object)
          }
          if object.responds(to: NSSelectorFromString("accessibilityChildren")) {
            for child in (object.value(forKey: "accessibilityChildren") as? [Any]) ?? [] {
              if let found = find(child) {
                return found
              }
            }
          }
          for subview in (object as? NSView)?.subviews ?? [] {
            if let found = find(subview) {
              return found
            }
          }
          return nil
        }
        return find(host)
      }

      private static func textField(in view: NSView) -> NSTextField? {
        if let field = view as? NSTextField, field.isEditable {
          return field
        }
        return view.subviews.lazy.compactMap { textField(in: $0) }.first
      }
    }
  }
#endif

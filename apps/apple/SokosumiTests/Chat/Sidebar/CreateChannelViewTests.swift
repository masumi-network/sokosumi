#if os(macOS)
  import AppKit
  @testable import Sokosumi
  import SokosumiChat
  import SwiftUI
  import Testing

  extension NativeWindowTests {
    @MainActor struct CreateChannelViewTests {
      @Test(arguments: [false, true], [false, true])
      func rendersBothSteps(dark: Bool, participants: Bool) async throws {
        let roster = ChannelRoster(recipients: .init(targets: [
          .init(id: .human("me"), name: "Alex Morgan", detail: "alex@example.com"),
          .init(id: .human("peer"), name: "Sam Rivera", detail: "sam@example.com"),
          .init(id: .coworker("agent"), name: "Research assistant", detail: "Research and analysis"),
          .init(id: .sokoBot("bot"), name: "Personal assistant")
        ]), isOwnerOrAdmin: true)
        let model = ChannelCreation()
        await model.load { roster }
        model.draft.setSlug("team-soko")
        await model.checkSlug { _ in true }
        if participants {
          model.advance()
          model.draft.addAllMembers = false
        }
        var didLoad = false
        let content = CreateChannelView(currentUserId: "me", organizationName: "Acme", model: model,
                                        load: {
                                          didLoad = true
                                          return roster
                                        }, checkSlug: { _ in true }, create: { _, _ in
                                          Issue.record("Rendering must not create a channel")
                                          return false
                                        })
                                        .background(.background)
                                        .environment(\.colorScheme, dark ? .dark : .light)
        let host = NSHostingView(rootView: content)
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 480, height: 540), styleMask: [.titled], backing: .buffered, defer: false)
        window.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        window.contentView = host
        window.orderFront(nil)
        defer { window.orderOut(nil) }
        host.layoutSubtreeIfNeeded()
        for _ in 0 ..< 100 {
          if didLoad, !model.loading, participants || model.availability == .free {
            break
          }
          try await Task.sleep(for: .milliseconds(20))
        }
        #expect(didLoad && !model.loading)
        #expect(participants || model.availability == .free)
        try await Task.sleep(for: .milliseconds(100))
        host.layoutSubtreeIfNeeded()
      }
    }
  }
#endif

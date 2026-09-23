#if os(macOS)
  import AppKit
  import CoreAPI
  @testable import Sokosumi
  import SokosumiAuth
  import SokosumiChat
  import SokosumiWorkspace
  import SwiftUI
  import Synchronization
  import Testing

  /// The real `MessageEditComposer` in a window, editing "Original" (message_1 in room_1), with
  /// `WorkspaceState` and `AuthState` in the environment. Rows 18a (keys) and 18b (chrome) drive it.
  @MainActor struct MessageEditComposerFixture {
    let window: NSWindow
    let host: NSView
    let editing: MessageEditing
    let input: MacComposerTextInput.InputView

    /// `client` answers the edit's PATCH; without one `saveMessageEdit` stops at `resolveClient`.
    static func make(dark: Bool = false, client: Client? = nil) async throws -> MessageEditComposerFixture {
      var message = chatRoomMessage(from: .init(clientTurnId: "turn", roomId: "room_1", content: "Original",
                                                sender: .init(id: "user", name: "Ada", email: "ada@example.com", presence: .online)))
      message.id = "message_1"
      // The workspace's own editor, as `MessageRowView` passes it: `saveMessageEdit` saves that one.
      let workspaces = client.map { client in WorkspaceState(clientProvider: { _ in client }) } ?? WorkspaceState()
      let editing = workspaces.messageEditing
      editing.start(message, userId: "user")
      let content = MessageEditComposer(editing: editing)
        .environmentObject(workspaces)
        .environmentObject(AuthState())
        .padding(16)
        .frame(width: 480, alignment: .topLeading)
        .background(.background)
        .environment(\.colorScheme, dark ? .dark : .light)
      let host = NSHostingView(rootView: content)
      let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 480, height: 200), styleMask: [.titled], backing: .buffered, defer: false)
      window.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
      window.contentView = host
      window.makeKeyAndOrderFront(nil)
      let input = try await waitForView(in: host, timeoutMessage: "The edit composer did not mount its text view") {
        inputView(in: host).flatMap { $0.serializedDraft == "Original" ? $0 : nil }
      }
      #expect(input.modifierReturnSubmits, "The edit composer puts its text view in edit mode.")
      return MessageEditComposerFixture(window: window, host: host, editing: editing, input: input)
    }

    /// A client whose requests reach `EditRequestProtocol`, which records them and never answers.
    static func heldClient() throws -> Client {
      let configuration = URLSessionConfiguration.ephemeral
      configuration.protocolClasses = [EditRequestProtocol.self]
      return try Client.connecting(to: #require(URL(string: "https://edit-fixture.invalid/v1")),
                                   session: URLSession(configuration: configuration))
    }

    func waitForDraft(_ draft: String) async throws {
      _ = try await waitForView(in: input, timeoutMessage: "The draft \(draft.prefix(40).debugDescription) did not reach the text view") {
        input.serializedDraft == draft ? input : nil
      }
    }

    static func returnEvent(_ modifiers: NSEvent.ModifierFlags = []) throws -> NSEvent {
      try #require(NSEvent.keyEvent(
        with: .keyDown, location: .zero, modifierFlags: modifiers,
        timestamp: 0, windowNumber: 0, context: nil,
        characters: "\r", charactersIgnoringModifiers: "\r", isARepeat: false, keyCode: 36
      ))
    }

    // MARK: Pixels

    /// The window fitted to the composer, then drawn.
    func bitmap() throws -> NSBitmapImageRep {
      window.setContentSize(host.fittingSize)
      host.layoutSubtreeIfNeeded()
      let bitmap = try #require(host.bitmapImageRepForCachingDisplay(in: host.bounds))
      host.cacheDisplay(in: host.bounds, to: bitmap)
      return bitmap
    }

    /// Recorded on the result bundle, which the app sandbox cannot hide: `xcresulttool export attachments`.
    func record(named name: String) throws -> NSBitmapImageRep {
      let bitmap = try bitmap()
      try Attachment.record(#require(bitmap.representation(using: .png, properties: [:])), named: name)
      return bitmap
    }

    /// Bitmap pixels per point.
    func scale(of bitmap: NSBitmapImageRep) -> CGFloat {
      CGFloat(bitmap.pixelsWide) / host.bounds.width
    }

    /// A rect in `view`'s coordinates as bitmap pixels, origin top left.
    func pixelRect(_ rect: CGRect, of view: NSView, in bitmap: NSBitmapImageRep) -> CGRect {
      var rect = view.convert(rect, to: host)
      if !host.isFlipped {
        rect.origin.y = host.bounds.height - rect.maxY
      }
      let scale = scale(of: bitmap)
      return CGRect(x: rect.minX * scale, y: rect.minY * scale, width: rect.width * scale, height: rect.height * scale)
        .intersection(CGRect(x: 0, y: 0, width: bitmap.pixelsWide, height: bitmap.pixelsHigh))
    }

    /// The text field (its scroll view) in bitmap pixels.
    func fieldRect(in bitmap: NSBitmapImageRep) -> CGRect {
      let field = input.enclosingScrollView ?? input
      return pixelRect(field.bounds, of: field, in: bitmap)
    }

    /// The first line of text in bitmap pixels.
    func firstLineRect(in bitmap: NSBitmapImageRep) throws -> CGRect {
      let layout = try #require(input.layoutManager)
      var line = layout.lineFragmentRect(forGlyphAt: 0, effectiveRange: nil)
      line.origin.x += input.textContainerOrigin.x
      line.origin.y += input.textContainerOrigin.y
      return pixelRect(line, of: input, in: bitmap)
    }

    /// Clicks the point at bitmap pixel `pixel`.
    func click(atPixel pixel: CGPoint, in bitmap: NSBitmapImageRep) {
      let scale = scale(of: bitmap)
      var point = CGPoint(x: pixel.x / scale, y: pixel.y / scale)
      if !host.isFlipped {
        point.y = host.bounds.height - point.y
      }
      let location = host.convert(point, to: nil)
      for type in [NSEvent.EventType.leftMouseDown, .leftMouseUp] {
        guard let event = NSEvent.mouseEvent(with: type, location: location, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
                                             windowNumber: window.windowNumber, context: nil, eventNumber: 0, clickCount: 1, pressure: 1) else { continue }
        window.sendEvent(event)
      }
    }

    private static func inputView(in view: NSView) -> MacComposerTextInput.InputView? {
      if let input = view as? MacComposerTextInput.InputView {
        return input
      }
      return view.subviews.lazy.compactMap { inputView(in: $0) }.first
    }
  }

  /// Records each request as "METHOD path" and never answers, so a save stays in flight until the test
  /// cancels it.
  final nonisolated class EditRequestProtocol: URLProtocol, @unchecked Sendable {
    private static let recorded = Mutex<[String]>([])

    static var requests: [String] {
      recorded.withLock { $0 }
    }

    static func reset() {
      recorded.withLock { $0 = [] }
    }

    override static func canInit(with request: URLRequest) -> Bool {
      request.url?.host == "edit-fixture.invalid"
    }

    override static func canonicalRequest(for request: URLRequest) -> URLRequest {
      request
    }

    override func startLoading() {
      let line = "\(request.httpMethod ?? "?") \(request.url?.path ?? "")"
      Self.recorded.withLock { $0.append(line) }
    }

    override func stopLoading() {}
  }
#endif

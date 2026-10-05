#if os(macOS)
  import AppKit
  import ApplicationServices
  @testable import Sokosumi

  /// Every string a hosted view exposes, read without OCR: the labels, values and titles of SwiftUI's accessibility
  /// nodes and of AppKit views (an alert's text fields included), and the composer input's placeholder.
  ///
  /// SwiftUI builds its accessibility nodes only once an accessibility client has asked the app for something; until
  /// then an `NSHostingView` reports no children. One request to this process's own accessibility element, made off
  /// the main actor so the main run loop can answer it, turns them on for the rest of the run. The request needs no
  /// accessibility permission: it fails for an untrusted process and still wakes the nodes.
  @MainActor func hostedTexts(in view: NSView) async -> [String] {
    await wakeAccessibility()
    var texts: [String] = []
    var seen: Set<ObjectIdentifier> = []
    func collect(_ element: Any) {
      guard let object = element as? NSObject, seen.insert(ObjectIdentifier(object)).inserted else { return }
      for key in ["accessibilityLabel", "accessibilityValue", "accessibilityTitle"]
        where object.responds(to: NSSelectorFromString(key)) {
        if let text = object.value(forKey: key) as? String, !text.isEmpty {
          texts.append(text)
        }
      }
      if let field = object as? NSTextField, !field.stringValue.isEmpty {
        texts.append(field.stringValue)
      }
      if let input = object as? MacComposerTextInput.InputView, !input.placeholder.isEmpty {
        texts.append(input.placeholder)
      }
      if object.responds(to: NSSelectorFromString("accessibilityChildren")) {
        for child in (object.value(forKey: "accessibilityChildren") as? [Any]) ?? [] {
          collect(child)
        }
      }
      for subview in (object as? NSView)?.subviews ?? [] {
        collect(subview)
      }
    }
    collect(view)
    return texts
  }

  @MainActor private var accessibilityAwake = false

  @MainActor private func wakeAccessibility() async {
    guard !accessibilityAwake else { return }
    let pid = ProcessInfo.processInfo.processIdentifier
    await Task.detached {
      let app = AXUIElementCreateApplication(pid)
      AXUIElementSetMessagingTimeout(app, 2)
      var windows: AnyObject?
      _ = AXUIElementCopyAttributeValue(app, kAXWindowsAttribute as CFString, &windows)
    }.value
    accessibilityAwake = true
  }
#endif

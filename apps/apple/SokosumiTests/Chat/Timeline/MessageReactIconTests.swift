#if os(macOS)
  import AppKit
  @testable import Sokosumi
  import SwiftUI
  import Testing

  extension NativeWindowTests {
    /// `face.smiling` resolves to a filled disc in dark. The message row's React action and the reaction
    /// picker's Smileys & People tab draw it as an outline in the grey of their neighbours, as in light.
    /// Each render adds a reference icon drawn the old way (no scheme override) as the independent grey.
    /// Windows are non-key: no test window becomes key in the test host, so key-window rendering stays unverified.
    @MainActor struct MessageReactIconTests {
      private static let padding: CGFloat = 8

      @Test(arguments: [false, true])
      func reactActionIsAnOutlineInTheReplyGrey(dark: Bool) async throws {
        let content = HStack(spacing: 0) {
          MessageActionLabel(title: "React", symbol: "face.smiling", hovered: false, compact: true, iconSize: 16, height: 28)
          MessageActionLabel(title: "Reply", symbol: "text.bubble", hovered: false, compact: true, iconSize: 16, height: 28)
          // The reference: the label as the row drew it before the fix.
          Image(systemName: "text.bubble")
            .font(.callout)
            .frame(width: 16, height: 16)
            .padding(.horizontal, 8)
            .frame(height: 28)
            .foregroundStyle(.secondary)
        }
        .padding(Self.padding)
        let name = "message-react-action-\(dark ? "dark" : "light").png"
        let render = try await Self.render(content, dark: dark, named: name) { host in
          let cell = CGRect(x: Self.padding, y: Self.padding, width: (host.bounds.width - 2 * Self.padding) / 3, height: host.bounds.height - 2 * Self.padding)
          return (0 ..< 3).map { cell.offsetBy(dx: CGFloat($0) * cell.width, dy: 0) }
        }
        try Self.expectOutline(render, icon: 0, neighbour: 1, reference: 2)
      }

      @Test(arguments: [false, true])
      func pickerPeopleTabIsAnOutlineInTheTabGrey(dark: Bool) async throws {
        let name = "reaction-picker-tabs-\(dark ? "dark" : "light").png"
        // Nine tabs (search, then the eight categories) share the 360 pt row after 8 pt padding and 2 pt spacing.
        let tabWidth = (360 - 2 * Self.padding - 8 * 2) / 9
        let content = VStack(alignment: .leading, spacing: 0) {
          ReactionEmojiPicker { _ in }
          // The reference: the Animals & Nature tab icon as the picker drew it before the fix.
          Button {} label: {
            Image(systemName: "leaf").font(.title3).frame(width: tabWidth, height: 30)
          }
          .buttonStyle(.plain)
          .padding(.leading, Self.padding)
        }
        let render = try await Self.render(content, dark: dark, named: name) { _ in
          let tabs = (0 ..< 9).map { CGRect(x: Self.padding + CGFloat($0) * (tabWidth + 2), y: Self.padding, width: tabWidth, height: 30) }
          return tabs + [CGRect(x: Self.padding, y: 440, width: tabWidth, height: 30)]
        }
        // Tab 1 is Smileys & People (`face.smiling`), tab 2 Animals & Nature (`leaf`), cell 9 the reference.
        try Self.expectOutline(render, icon: 1, neighbour: 2, reference: 9)
      }

      // MARK: Pixels

      /// Draws `content` in a window and waits until every cell `layout` names has ink.
      private static func render(
        _ content: some View, dark: Bool, named name: String, layout: (NSView) -> [CGRect]
      ) async throws -> IconRender {
        let host = NSHostingView(rootView: content.background(.background).environment(\.colorScheme, dark ? .dark : .light))
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 100, height: 60), styleMask: [.titled], backing: .buffered, defer: false)
        window.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        window.contentView = host
        window.orderFront(nil)
        defer { window.orderOut(nil) }
        var cells: [CGRect] = []
        _ = try await waitForView(in: host, timeoutMessage: "\(name) did not draw") {
          window.setContentSize(host.fittingSize)
          host.layoutSubtreeIfNeeded()
          cells = layout(host)
          guard let bitmap = try? bitmap(host), cells.allSatisfy({ ink(in: bitmap, host: host, cell: $0) != nil }) else { return nil }
          return host
        }
        let bitmap = try bitmap(host)
        try Attachment.record(#require(bitmap.representation(using: .png, properties: [:])), named: name)
        return IconRender(name: name, host: host, bitmap: bitmap, cells: cells)
      }

      /// The face is an outline, and it and its neighbour match the grey of the reference drawn the old way.
      private static func expectOutline(_ render: IconRender, icon: Int, neighbour: Int, reference: Int) throws {
        let name = render.name
        let face = try #require(ink(in: render.bitmap, host: render.host, cell: render.cells[icon]), "The face did not draw (\(name)).")
        let other = try #require(ink(in: render.bitmap, host: render.host, cell: render.cells[neighbour]), "The neighbour did not draw (\(name)).")
        let old = try #require(ink(in: render.bitmap, host: render.host, cell: render.cells[reference]), "The reference did not draw (\(name)).")
        // A disc inks about 78 % of its bounding box, the outlined face about a third.
        #expect(face.coverage < 0.5, "\(Int(face.coverage * 100)) % of the face's bounds is inked, so it draws as a disc (\(name)).")
        for (label, ink) in [("face", face), ("neighbour", other)] {
          #expect(abs(ink.contrast - old.contrast) < 0.08,
                  "The \(label)'s ink (\(ink.contrast)) differs from the reference drawn the old way (\(old.contrast)) (\(name)).")
        }
      }

      /// Measures the ink in `cell` (points, origin top left) against the cell's corner pixel, or nil when it has none.
      private static func ink(in bitmap: NSBitmapImageRep, host: NSView, cell: CGRect) -> IconInk? {
        let scale = CGFloat(bitmap.pixelsWide) / host.bounds.width
        let minX = Int(cell.minX * scale) + 2, maxX = Int(cell.maxX * scale) - 2
        let minY = Int(cell.minY * scale) + 2, maxY = Int(cell.maxY * scale) - 2
        guard minX < maxX, minY < maxY, let corner = color(in: bitmap, column: minX, row: minY) else { return nil }
        let base = luminance(corner)
        var inked = 0
        var contrast = 0.0
        var left = Int.max, right = Int.min, top = Int.max, bottom = Int.min
        for row in minY ..< maxY {
          for column in minX ..< maxX {
            guard let pixel = color(in: bitmap, column: column, row: row) else { continue }
            let difference = abs(luminance(pixel) - base)
            guard difference > 0.1 else { continue }
            inked += 1
            contrast = max(contrast, difference)
            left = min(left, column)
            right = max(right, column)
            top = min(top, row)
            bottom = max(bottom, row)
          }
        }
        guard inked > 0 else { return nil }
        let area = Double((right - left + 1) * (bottom - top + 1))
        return IconInk(coverage: Double(inked) / area, contrast: contrast)
      }

      private static func color(in bitmap: NSBitmapImageRep, column: Int, row: Int) -> NSColor? {
        bitmap.colorAt(x: column, y: row)?.usingColorSpace(.sRGB)
      }

      private static func luminance(_ color: NSColor) -> Double {
        Double(0.2126 * color.redComponent + 0.7152 * color.greenComponent + 0.0722 * color.blueComponent)
      }

      private static func bitmap(_ view: NSView) throws -> NSBitmapImageRep {
        let bitmap = try #require(view.bitmapImageRepForCachingDisplay(in: view.bounds))
        view.cacheDisplay(in: view.bounds, to: bitmap)
        return bitmap
      }
    }
  }

  private struct IconRender {
    let name: String
    let host: NSView
    let bitmap: NSBitmapImageRep
    /// The measured cells in points, origin top left.
    let cells: [CGRect]
  }

  private struct IconInk {
    /// Share of the ink's bounding box that is inked.
    let coverage: Double
    /// The strongest luminance difference from the cell's background.
    let contrast: Double
  }
#endif

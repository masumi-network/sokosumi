#if os(macOS)
  import AppKit
  import CoreAPI
  @testable import Sokosumi
  import SokosumiChat
  import SwiftUI
  import Testing

  @MainActor
  struct PresenceDotTests {
    @Test func labelsMatchWeb() {
      #expect(presenceLabel(.online) == "Online")
      #expect(presenceLabel(.afk) == "Away")
      #expect(presenceLabel(.offline) == "Offline")
    }

    /// Draws `content` at the top-leading corner of a 40 pt blue ground and reads the pixel at `point`, plus the
    /// ground's own pixel at the far corner, both through the same renderer.
    private static func sample(_ point: CGPoint, of content: some View) throws -> (pixel: NSColor, ground: NSColor) {
      let scale: CGFloat = 4
      let renderer = ImageRenderer(content: ZStack(alignment: .topLeading) {
        Color(red: 0, green: 0, blue: 1).frame(width: 40, height: 40)
        content
      })
      renderer.scale = scale
      let bitmap = try NSBitmapImageRep(cgImage: #require(renderer.cgImage))
      let pixel = try #require(bitmap.colorAt(x: Int(point.x * scale), y: Int(point.y * scale))?.usingColorSpace(.sRGB))
      let ground = try #require(bitmap.colorAt(x: Int(39 * scale), y: Int(39 * scale))?.usingColorSpace(.sRGB))
      return (pixel, ground)
    }

    private static func close(_ lhs: NSColor, _ rhs: NSColor) -> Bool {
      abs(lhs.redComponent - rhs.redComponent) < 0.05 && abs(lhs.greenComponent - rhs.greenComponent) < 0.05
        && abs(lhs.blueComponent - rhs.blueComponent) < 0.05 && abs(lhs.alphaComponent - rhs.alphaComponent) < 0.05
    }

    private static func expectGround(_ point: CGPoint, of content: some View) throws {
      let (pixel, ground) = try sample(point, of: content)
      #expect(close(pixel, ground), "\(pixel) vs ground \(ground)")
    }

    /// A 28 pt red face; its 10 pt mark is centred on (25, 25).
    private static func badge(_ presence: Components.Schemas.ChatRoomPresence) -> some View {
      Circle().fill(Color(red: 1, green: 0, blue: 0)).frame(width: 28, height: 28).presenceBadge(presence)
    }

    /// The halo, the bite and the offline hole show what is behind the avatar, as web's ground-painted ones do on
    /// its one-colour sidebar; a Mac sidebar is material, selection or hover, never the window background.
    @Test func haloBiteAndHoleShowTheGround() throws {
      // Halfway through the 1 pt halo, up-left of the mark, over the face.
      try Self.expectGround(CGPoint(x: 21.8, y: 21.8), of: Self.badge(.online))
      // Inside the crescent's bite.
      try Self.expectGround(CGPoint(x: 26.5, y: 23.5), of: Self.badge(.afk))
      // The offline ring's hole, where it covers the face.
      try Self.expectGround(CGPoint(x: 23.4, y: 23.4), of: Self.badge(.offline))
    }

    /// Web `--semantic-success` (light): hsl(142 72% 27%).
    @Test func onlineUsesWebSuccess() throws {
      let mark = try Self.sample(CGPoint(x: 25, y: 25), of: Self.badge(.online)).pixel
      let token = try Self.sample(CGPoint(x: 5, y: 5), of: Color(red: 0.076, green: 0.464, blue: 0.218).frame(width: 10, height: 10)).pixel
      #expect(Self.close(mark, token), "\(mark) vs \(token)")
    }

    /// The ring between overlapping Direct faces is cut through to the ground too.
    @Test func directStackRingShowsTheGround() throws {
      let stack = DirectRoomAvatarStack(participants: [
        DirectRoomAvatarParticipant(id: "a", name: "Ada", imageURL: nil),
        DirectRoomAvatarParticipant(id: "b", name: "Bea", imageURL: nil)
      ])
      // The first face's right edge, where it covers the second face (20 pt faces, 6 pt overlap).
      try Self.expectGround(CGPoint(x: 19.5, y: 10), of: stack)
      // Inside the second face.
      let (face, ground) = try Self.sample(CGPoint(x: 28, y: 10), of: stack)
      #expect(!Self.close(face, ground), "\(face)")
    }

    /// A Read-only Direct's ring fades with its faces: the face under it shows at half its own dimmed strength.
    @Test func dimmedDirectStackRingFadesWithTheFaces() throws {
      let stack = DirectRoomAvatarStack(participants: [
        DirectRoomAvatarParticipant(id: "a", name: "Ada", imageURL: nil),
        DirectRoomAvatarParticipant(id: "b", name: "Bea", imageURL: nil)
      ], isDimmed: true)
      let (ring, ground) = try Self.sample(CGPoint(x: 19.5, y: 10), of: stack)
      let face = try Self.sample(CGPoint(x: 28, y: 10), of: stack).pixel
      let halfway = NSColor(srgbRed: (face.redComponent + ground.redComponent) / 2,
                            green: (face.greenComponent + ground.greenComponent) / 2,
                            blue: (face.blueComponent + ground.blueComponent) / 2, alpha: 1)
      #expect(Self.close(ring, halfway), "\(ring) vs \(halfway)")
    }
  }
#endif

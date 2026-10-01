import CoreAPI
import SokosumiChat
import SwiftUI

#if os(macOS)
  /// Row 31b1: web's `RoomSeenByLine` in the newest message's bottom-trailing corner. Quiet grey faces at
  /// half opacity that take their colour only while the faces themselves are hovered, focused or open —
  /// never because the message row is hovered. A native button opens a popover above them naming who read
  /// the message and when, then everyone who has not read this far.
  struct SeenByButton: View {
    let seenBy: SeenBy
    @State private var isOpen = false
    @State private var isHovered = false
    @FocusState private var isFocused: Bool

    var body: some View {
      Button { isOpen.toggle() } label: {
        SeenByFaces(seenBy: seenBy, awake: isOpen || isHovered || isFocused)
          .contentShape(.capsule)
      }
      .buttonStyle(.plain)
      .focused($isFocused)
      .onHover { isHovered = $0 }
      .help(seenBy.summary)
      .accessibilityLabel(seenBy.summary)
      .popover(isPresented: $isOpen, arrowEdge: .top) {
        SeenByDetail(seenBy: seenBy)
      }
    }
  }

  /// Overlapping faces, most-recent-read first and the first on top, capped at three with a `+N` for the rest.
  /// Opacity and grey go on the stack as one layer: per face, the overlaps would composite darker.
  struct SeenByFaces: View {
    /// Web's `size-4` faces overlapping by `-space-x-1`, as on the thread reply bar.
    static let faceDiameter: CGFloat = ThreadReplyBarButton.faceDiameter
    static let overlap: CGFloat = 4

    let seenBy: SeenBy
    let awake: Bool

    /// How much of the message column's trailing edge the faces cover.
    static func width(for seenBy: SeenBy) -> CGFloat {
      let count = CGFloat(seenBy.faces.count + (seenBy.overflowCount > 0 ? 1 : 0))
      return count * faceDiameter - max(0, count - 1) * overlap
    }

    var body: some View {
      HStack(spacing: -Self.overlap) {
        ForEach(Array(seenBy.faces.enumerated()), id: \.element.participant.id) { index, reader in
          ParticipantAvatar(imageURL: reader.participant.image, name: SeenBy.name(of: reader.participant),
                            size: Self.faceDiameter, monogram: true)
            .background(Circle().fill(.background).padding(-1))
            .zIndex(Double(seenBy.faces.count - index))
        }
        if seenBy.overflowCount > 0 {
          Text(verbatim: "+\(seenBy.overflowCount)")
            .font(.system(size: 8, weight: .medium))
            .foregroundStyle(.secondary)
            .frame(width: Self.faceDiameter, height: Self.faceDiameter)
            .background(Circle().fill(.quaternary).background(.background, in: .circle))
            .background(Circle().fill(.background).padding(-1))
        }
      }
      .modifier(SeenByTone(awake: awake))
      .accessibilityHidden(true)
    }
  }

  /// How loud the faces are (web's `quiet` tone): grey at half opacity at rest, their own colour once woken. One
  /// layer, so the overlapping faces do not composite darker where they meet.
  struct SeenByTone: ViewModifier {
    let awake: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
      content
        .compositingGroup()
        .grayscale(awake ? 0 : 1)
        .opacity(awake ? 1 : 0.5)
        .animation(reduceMotion ? nil : .easeOut(duration: 0.15), value: awake)
    }
  }

  /// The list behind the faces (web `SeenByDetail`): "Read by" and each reader with the clock time they read,
  /// then, under a divider with no heading, everyone who has not read this far in grey.
  struct SeenByDetail: View {
    /// Web's `w-56` popover and `max-h-64` list.
    static let width: CGFloat = 224
    static let maxListHeight: CGFloat = 256
    private static let rowHeight: CGFloat = 28
    private static let faceDiameter: CGFloat = 20

    let seenBy: SeenBy
    @Environment(\.timeFormat) private var timeFormat

    var body: some View {
      ScrollView {
        VStack(alignment: .leading, spacing: 0) {
          Text("Read by")
            .font(.caption)
            .fontWeight(.medium)
            .foregroundStyle(.secondary)
            .padding(.horizontal, 8)
            .padding(.top, 4)
            .padding(.bottom, 2)
            .accessibilityAddTraits(.isHeader)
          ForEach(seenBy.readers, id: \.participant.id) { reader in
            row(reader.participant, time: timeFormat.time(reader.lastReadAt))
          }
          if !seenBy.pending.isEmpty {
            Divider().padding(.vertical, 2)
            VStack(alignment: .leading, spacing: 0) {
              ForEach(seenBy.pending, id: \.id) { participant in
                row(participant, time: nil)
              }
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel("Not read yet")
          }
        }
        .padding(4)
      }
      .scrollBounceBehavior(.basedOnSize)
      .frame(width: Self.width)
      .frame(maxHeight: Self.maxListHeight)
      .fixedSize(horizontal: false, vertical: true)
    }

    /// A reader with their time, or, without one, a member who has not read this far: grey rather than
    /// absent, so they never read as readers.
    private func row(_ participant: RoomReadReceipts.Participant, time: String?) -> some View {
      HStack(spacing: 8) {
        ParticipantAvatar(imageURL: participant.image, name: SeenBy.name(of: participant), size: Self.faceDiameter, monogram: true)
          .grayscale(time == nil ? 1 : 0)
          .opacity(time == nil ? 0.6 : 1)
        Text(SeenBy.name(of: participant))
          .foregroundStyle(time == nil ? .secondary : .primary)
          .lineLimit(1)
          .truncationMode(.tail)
          .frame(maxWidth: .infinity, alignment: .leading)
        if let time {
          Text(time)
            .foregroundStyle(.secondary)
            .monospacedDigit()
            .fixedSize()
        }
      }
      .font(.caption)
      .padding(.horizontal, 8)
      .frame(height: Self.rowHeight)
      .accessibilityElement(children: .combine)
    }
  }
#endif

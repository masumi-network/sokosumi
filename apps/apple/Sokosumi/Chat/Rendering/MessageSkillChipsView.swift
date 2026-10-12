import CoreAPI
import SwiftUI

#if os(macOS)
  /// Web `MessageSkillChips` (row 42): the skills a message carries, as chips under its body. A chip opens a short
  /// preview with the skill's name, its description and a link to its skills.sh page; readers never get its content.
  struct MessageSkillChipsView: View {
    let skills: [Components.Schemas.ChatRoomMessageSkill]

    var body: some View {
      WrappingRow(spacing: 6) {
        ForEach(skills, id: \.id) { skill in
          MessageSkillChip(skill: skill)
        }
      }
      .padding(.top, 4)
    }
  }

  private struct MessageSkillChip: View {
    let skill: Components.Schemas.ChatRoomMessageSkill
    @State private var previewing = false
    @State private var hovered = false

    var body: some View {
      Button {
        previewing = true
      } label: {
        HStack(spacing: 6) {
          Image(systemName: "scroll")
            .foregroundStyle(.secondary)
            .accessibilityHidden(true)
          Text(skill.name)
            .lineLimit(1)
            .truncationMode(.tail)
        }
        .font(.caption.weight(.medium))
        .padding(.horizontal, 8)
        .frame(height: 24)
        .background(hovered ? AnyShapeStyle(.quaternary) : AnyShapeStyle(.background), in: .rect(cornerRadius: 6))
        .overlay {
          RoundedRectangle(cornerRadius: 6).stroke(.quaternary)
        }
        .contentShape(.rect)
      }
      .buttonStyle(.plain)
      .onHover { hovered = $0 }
      .accessibilityLabel("Skill: \(skill.name)")
      .popover(isPresented: $previewing, arrowEdge: .top) {
        MessageSkillPreview(skill: skill)
      }
    }
  }

  /// The chip's popover: web's kicker, the name, the description when there is one, and "View on skills.sh".
  struct MessageSkillPreview: View {
    let skill: Components.Schemas.ChatRoomMessageSkill

    var body: some View {
      VStack(alignment: .leading, spacing: 4) {
        Text("Skill from skills.sh, sent to the agents this message reaches")
          .font(.caption)
          .foregroundStyle(.secondary)
        Text(skill.name)
          .font(.callout.weight(.medium))
          .padding(.top, 2)
        if let description = skill.description, !description.isEmpty {
          Text(description)
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        if let url = URL(string: skill.url) {
          Link(destination: url) {
            HStack(spacing: 4) {
              Text("View on skills.sh")
              Image(systemName: "arrow.up.right.square")
                .accessibilityHidden(true)
            }
          }
          .font(.caption.weight(.medium))
          .padding(.top, 8)
        }
      }
      .fixedSize(horizontal: false, vertical: true)
      .frame(width: 260, alignment: .leading)
      .padding(12)
    }
  }
#endif

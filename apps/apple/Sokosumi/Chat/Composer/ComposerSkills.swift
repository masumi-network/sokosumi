import CoreAPI
import SokosumiChat
import SwiftUI

#if os(macOS)
  /// The skills.sh skills attached to the next message (row 42). A composer that cannot send them gets none, which
  /// hides both the chips and the button (web: `onSkillsChange` omitted).
  struct ComposerSkills {
    var selected: [Components.Schemas.ChatRoomMessageSkill]
    let search: (String) async throws -> [Components.Schemas.ChatSkillCatalogItem]
    let change: ([Components.Schemas.ChatRoomMessageSkill]) -> Void
  }

  /// Web `ComposerSkillChips`: one chip per attached skill at the top of the composer, its description as the
  /// tooltip, each with its own Remove control.
  struct ComposerSkillChips: View {
    let skills: [Components.Schemas.ChatRoomMessageSkill]
    let remove: (Components.Schemas.ChatRoomMessageSkill) -> Void

    var body: some View {
      WrappingRow(spacing: 6) {
        ForEach(skills, id: \.id) { skill in
          HStack(spacing: 4) {
            Image(systemName: "scroll")
              .foregroundStyle(.secondary)
              .accessibilityHidden(true)
            Text(skill.name)
              .lineLimit(1)
              .truncationMode(.tail)
              .help(skill.description ?? "")
            Button {
              remove(skill)
            } label: {
              Image(systemName: "xmark")
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.secondary)
                .frame(width: 16, height: 16)
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .help("Remove \(skill.name)")
            .accessibilityLabel("Remove \(skill.name)")
          }
          .font(.caption.weight(.medium))
          .padding(.leading, 8)
          .padding(.trailing, 4)
          .frame(height: 24)
          .background(.background, in: .rect(cornerRadius: 6))
          .overlay {
            RoundedRectangle(cornerRadius: 6).stroke(.quaternary)
          }
          .accessibilityElement(children: .contain)
        }
      }
    }
  }

  /// Web `SkillPicker`'s trigger: the composer's skill button beside Emoji, disabled once the message holds
  /// `MessageSkills.maxPerMessage`. It opens the search in a popover; picking attaches the skill, closes the popover
  /// and puts the caret back in the editor.
  struct ComposerSkillButton: View {
    let skills: ComposerSkills
    let focusEditor: () -> Void
    @State private var presented = false

    var body: some View {
      let full = MessageSkills.isFull(skills.selected)
      ComposerToolbarButton(title: "Add a skill", symbol: "scroll", help: full ? "Up to 3 skills per message" : nil) {
        presented = true
      }
      .disabled(full)
      .accessibilityIdentifier("composer.skillPicker")
      .popover(isPresented: $presented, arrowEdge: .top) {
        SkillPickerView(attached: Set(skills.selected.map(\.id)), search: skills.search) { item in
          skills.change(MessageSkills.attaching(MessageSkills.chip(for: item), to: skills.selected))
          presented = false
          focusEditor()
        }
      }
    }
  }
#endif

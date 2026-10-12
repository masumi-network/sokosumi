import CoreAPI
import Foundation

/// skills.sh skills a sender attaches to a chat message (row 42; web `skill-picker.tsx`, `skill-chip.tsx`). Core hands
/// each skill's content to the coworkers and Soko Bots the message reaches; readers only see the chips.
public enum MessageSkills {
  /// Web `MAX_SKILLS_PER_MESSAGE`; Core refuses a fourth.
  public static let maxPerMessage = 3

  /// Web `shouldAllowRoomSkills`: skills only reach an agent, so the composer offers them where a coworker or Soko Bot
  /// is a member, and never in the coworker 1:1, whose room stream send carries no skills.
  public static func allowed(in room: Components.Schemas.ChatRoom?) -> Bool {
    guard let room, !DirectStreamSession.supports(room) else { return false }
    return room.coworkerMembers.count + room.sokoBotMembers.count > 0
  }

  /// The chip a picked catalog skill becomes (web `skillChipFromCatalog`).
  public static func chip(for item: Components.Schemas.ChatSkillCatalogItem) -> Components.Schemas.ChatRoomMessageSkill {
    .init(id: item.id, name: item.name, description: item.description, url: "https://skills.sh/\(item.id)")
  }

  public static func isFull(_ skills: [Components.Schemas.ChatRoomMessageSkill]) -> Bool {
    skills.count >= maxPerMessage
  }

  /// `skills` with `skill` attached last; unchanged when it is already attached or the message is full.
  public static func attaching(
    _ skill: Components.Schemas.ChatRoomMessageSkill,
    to skills: [Components.Schemas.ChatRoomMessageSkill]
  ) -> [Components.Schemas.ChatRoomMessageSkill] {
    guard !isFull(skills), !skills.contains(where: { $0.id == skill.id }) else { return skills }
    return skills + [skill]
  }

  /// Web `installs` "{count} installs", the count in compact notation ("1.2K").
  public static func installsLabel(_ installs: Int, locale: Locale = .current) -> String {
    "\(installs.formatted(.number.notation(.compactName).locale(locale))) installs"
  }
}

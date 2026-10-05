import CoreAPI

public extension Components.Schemas.ChatRoomMessageReaction {
  /// Who reacted, for the chip's tooltip (web `formatWhoReactedLabel`). Core names only the first reactors, so the
  /// rest are a count. Nil when there is neither a name nor a remainder: web shows no tooltip then.
  var whoReacted: String? {
    let names = reactors.map(\.name).joined(separator: ", ")
    let remaining = max(0, count - reactors.count)
    guard remaining > 0 else { return names.isEmpty ? nil : names }
    return names.isEmpty ? "and \(remaining) more" : "\(names), and \(remaining) more"
  }
}

import CoreAPI

/// The mark a Channel's discoverability carries (web `channelKindIcon` / `ChannelKindGlyph`,
/// `channel-discoverability-icon.tsx`): `#` for public, a lock for private, a globe for external and matched.
/// Every Apple surface that draws a Channel's kind reads it here — the sidebar rows, the room header, the
/// Members inspector's line, the Archived rows and Browse channels — and the app picks the symbol once.
public enum ChannelMark: Equatable, Sendable {
  case hash
  case lock
  case globe

  /// A room's discoverability. Directs carry none and read as `#`, as web's `?? Hash` does; they never draw it.
  public init(_ discoverability: Components.Schemas.ChatRoom.DiscoverabilityPayload?) {
    switch discoverability {
    case ._private: self = .lock
    case .external, .matched: self = .globe
    case ._public, ._empty_, nil: self = .hash
    }
  }

  /// A Browse channels row. Core never lists a matched channel there.
  public init(_ discoverability: Components.Schemas.DiscoverableChannelDiscoverability) {
    switch discoverability {
    case ._private: self = .lock
    case .external: self = .globe
    case ._public: self = .hash
    }
  }

  /// The Members inspector's line and the mark's spoken name. Web writes no such text (the glyph is
  /// `aria-hidden`), so it follows the mark: matched reads as External, as its globe and sidebar section do.
  public var channelDescription: String {
    switch self {
    case .hash: "Public channel"
    case .lock: "Private channel"
    case .globe: "External channel"
    }
  }
}

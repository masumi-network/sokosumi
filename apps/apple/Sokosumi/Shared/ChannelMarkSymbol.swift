import SokosumiChat

extension ChannelMark {
  /// SF Symbols for web's lucide `Hash`, `Lock` and `Globe2`: the one place a Channel's kind becomes a symbol.
  var systemImage: String {
    switch self {
    case .hash: "number"
    case .lock: "lock"
    case .globe: "globe"
    }
  }
}

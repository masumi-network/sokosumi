import SwiftUI

/// The window's one Channel settings sheet and one Name Group sheet. The sidebar row menu, the Members inspector and
/// the title bar's room name all ask for them here, as web's room shell owns the one dialog its header title and
/// sidebar row open (`rooms-client.tsx` `editChannelOpen`).
@MainActor @Observable final class RoomEditSheets {
  var editChannel: RoomEditPresentation?
  var nameGroup: RoomEditPresentation?
}

/// Owns the window's `RoomEditSheets` and presents them over everything inside.
struct RoomEditSheetsHost: ViewModifier {
  @State private var sheets = RoomEditSheets()

  func body(content: Content) -> some View {
    @Bindable var sheets = sheets
    content
      .environment(sheets)
      .modifier(EditChannelSheet(presentation: $sheets.editChannel))
      .modifier(NameGroupSheet(presentation: $sheets.nameGroup))
  }
}

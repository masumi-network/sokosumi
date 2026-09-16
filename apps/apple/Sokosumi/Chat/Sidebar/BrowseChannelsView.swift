import CoreAPI
import SokosumiChat
import SwiftUI

struct BrowseChannelsView: View {
  let load: (String) async throws -> [Components.Schemas.DiscoverableChatRoom]
  let join: (String) async throws -> Bool
  @StateObject private var model: ChannelBrowser
  @State private var retry = 0
  @FocusState private var searchFocused: Bool
  @Environment(\.dismiss) private var dismiss

  init(model: ChannelBrowser = ChannelBrowser(), load: @escaping (String) async throws -> [Components.Schemas.DiscoverableChatRoom], join: @escaping (String) async throws -> Bool) {
    _model = StateObject(wrappedValue: model)
    self.load = load
    self.join = join
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      Text("Browse channels").font(.title2).fontWeight(.semibold)
      Text("Find and join channels in your organization.").foregroundStyle(.secondary)
      TextField("Search channels", text: $model.query)
        .textFieldStyle(.roundedBorder)
        .focused($searchFocused)
        .task { searchFocused = true }
      List {
        if model.loading {
          ProgressView("Loading channels…")
        } else if let error = model.loadError {
          VStack(alignment: .leading, spacing: 8) {
            Text(error).foregroundStyle(.secondary)
            Button("Retry") { retry += 1 }
          }
        } else if model.rooms.isEmpty {
          Text("No channels found.").foregroundStyle(.secondary)
        } else {
          ForEach(model.rooms, id: \.id) { room in
            channelRow(room)
          }
        }
      }
      .listStyle(.plain)
      .frame(height: 320)
      if let error = model.joinError {
        Text(error).font(.callout).foregroundStyle(.red)
      }
      HStack {
        Spacer()
        Button("Done") { dismiss() }.keyboardShortcut(.cancelAction)
      }
    }
    .padding(20)
    .frame(width: 480)
    .interactiveDismissDisabled(model.joiningRoomId != nil)
    .disabled(model.joiningRoomId != nil)
    .task(id: SearchRequest(query: model.query, retry: retry)) {
      await model.search { query in
        try await Task.sleep(for: .milliseconds(200))
        return try await load(query)
      }
    }
  }

  private func channelRow(_ room: Components.Schemas.DiscoverableChatRoom) -> some View {
    HStack(alignment: .top, spacing: 12) {
      Image(systemName: room.discoverability == ._private ? "lock" : room.discoverability == .external ? "globe" : "number")
        .foregroundStyle(.secondary)
        .frame(width: 20)
        .accessibilityLabel(room.discoverability.rawValue)
      VStack(alignment: .leading, spacing: 4) {
        Text(room.name).fontWeight(.medium).lineLimit(1)
        if let topic = room.topic, !topic.isEmpty {
          Text(topic).font(.caption).foregroundStyle(.secondary).lineLimit(2)
        }
        Text("\(room.memberCount) \(room.memberCount == 1 ? "member" : "members")")
          .font(.caption).foregroundStyle(.secondary)
      }
      Spacer(minLength: 8)
      Button(model.joiningRoomId == room.id ? "Joining…" : "Join") {
        Task {
          if await model.join(roomId: room.id, using: join) {
            dismiss()
          }
        }
      }
      .controlSize(.small)
      .accessibilityLabel("Join \(room.name)")
    }
    .padding(.vertical, 4)
  }

  private struct SearchRequest: Equatable {
    let query: String
    let retry: Int
  }
}

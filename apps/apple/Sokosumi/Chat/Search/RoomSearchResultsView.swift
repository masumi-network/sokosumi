import CoreAPI
import SokosumiChat
import SwiftUI

struct RoomSearchResultsView: View {
  @ObservedObject var search: RoomSearch
  let query: String
  let jumpingId: String?
  let jumpError: String?
  let select: (Components.Schemas.ChatRoomMessage) -> Void
  let retry: () -> Void
  let close: () -> Void

  var body: some View {
    // Row 23a: the model decides; hits stay while the next query is pending, as on web.
    let presentation = search.presentation(for: query)
    let selectedId = search.selectedId
    let placeholder = presentation.placeholder == .loading ? .loading
      : jumpError.map(RoomSearchPresentation.Placeholder.failed) ?? presentation.placeholder
    VStack(spacing: 0) {
      HStack {
        Text("Search messages").font(.headline)
        Spacer()
        Button("Close search", systemImage: "xmark", action: close)
          .labelStyle(.iconOnly).buttonStyle(.borderless).help("Close search")
      }.padding(16)
      Divider()
      ScrollViewReader { proxy in
        ScrollView {
          LazyVStack(alignment: .leading, spacing: 4) {
            switch placeholder {
            case .loading:
              ProgressView("Searching…").frame(maxWidth: .infinity).padding()
            case let .failed(error):
              Text(error).foregroundStyle(.secondary)
              Button("Retry search", action: retry)
            case .idle:
              Text("Search this conversation").foregroundStyle(.secondary).padding()
            case .empty:
              Text("No messages found").foregroundStyle(.secondary).padding()
            case nil:
              EmptyView()
            }
            ForEach(presentation.results, id: \.id) { message in
              Button { select(message) } label: {
                VStack(alignment: .leading, spacing: 4) {
                  HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(messageSenderName(message.sender)).fontWeight(.medium).lineLimit(1)
                    Spacer(minLength: 0)
                    Text(message.createdAt, style: .relative).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                  }
                  if message.parentMessageId != nil {
                    Label("Reply", systemImage: "text.bubble").font(.caption).foregroundStyle(.secondary)
                  }
                  Text(message.content).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.trailing, 28)
                .overlay(alignment: .trailing) {
                  if jumpingId == message.id {
                    ProgressView().controlSize(.small)
                      .accessibilityLabel("Opening message")
                      .frame(width: 20)
                  }
                }
                .padding(10)
                .background(selectedId == message.id ? Color.primary.opacity(0.08) : .clear, in: .rect(cornerRadius: 8))
                .contentShape(.rect)
              }
              .buttonStyle(.plain)
              .accessibilityAddTraits(selectedId == message.id ? .isSelected : [])
              .disabled(jumpingId != nil)
              .onHover {
                if $0 {
                  search.select(message.id)
                }
              }
              .id(message.id)
            }
          }.padding(8)
        }
        .onChange(of: search.selectedId) { _, id in
          if let id {
            proxy.scrollTo(id)
          }
        }
      }
    }.font(.callout)
  }
}

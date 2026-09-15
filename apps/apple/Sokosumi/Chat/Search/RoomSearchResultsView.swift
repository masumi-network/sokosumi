import CoreAPI
import SokosumiChat
import SwiftUI

struct RoomSearchResultsView: View {
  @ObservedObject var search: RoomSearch
  let query: String
  @Binding var selectedId: String?
  let jumpingId: String?
  let jumpError: String?
  let select: (Components.Schemas.ChatRoomMessage) -> Void
  let retry: () -> Void
  let close: () -> Void

  private var isPending: Bool {
    search.query != query.trimmingCharacters(in: .whitespacesAndNewlines)
  }

  private var results: [Components.Schemas.ChatRoomMessage] {
    isPending ? [] : search.results
  }

  var body: some View {
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
            if search.isLoading || (isPending && !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty) {
              ProgressView("Searching…").frame(maxWidth: .infinity).padding()
            } else if let error = jumpError ?? search.errorMessage {
              Text(error).foregroundStyle(.secondary)
              Button("Retry search", action: retry)
            } else if query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
              Text("Search this conversation").foregroundStyle(.secondary).padding()
            } else if search.results.isEmpty {
              Text("No messages found").foregroundStyle(.secondary).padding()
            }
            ForEach(results, id: \.id) { message in
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
              .disabled(jumpingId != nil || search.isLoading)
              .onHover {
                if $0 {
                  selectedId = message.id
                }
              }
              .id(message.id)
            }
          }.padding(8)
        }
        .onChange(of: selectedId) { _, id in
          if let id {
            proxy.scrollTo(id)
          }
        }
      }
    }.font(.callout)
  }
}

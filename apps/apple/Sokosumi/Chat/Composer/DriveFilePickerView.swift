import CoreAPI
import SokosumiChat
import SwiftUI

struct DriveFilePickerView: View {
  let load: (String, String) async throws -> [Components.Schemas.DriveItem]
  let select: (ComposeAttachment) -> Void
  @Environment(\.dismiss) private var dismiss
  @StateObject private var picker = DrivePicker()
  @State private var folders: [String] = []
  @State private var query = ""
  @State private var retry = 0

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      HStack {
        Text("Attach from Drive").font(.headline)
        Spacer()
        Button("Cancel") { dismiss() }.keyboardShortcut(.cancelAction)
      }
      HStack {
        Button("Drive", systemImage: "house") { folders = []
          query = ""
        }
        ForEach(folders.indices, id: \.self) { index in
          Image(systemName: "chevron.right").accessibilityHidden(true)
          Button(folders[index]) { folders = Array(folders.prefix(index + 1))
            query = ""
          }
        }
      }
      .buttonStyle(.borderless)
      TextField("Search this folder", text: $query).textFieldStyle(.roundedBorder)
      if picker.loading {
        ProgressView("Loading files…").frame(maxWidth: .infinity, maxHeight: .infinity)
      } else if let error = picker.errorMessage {
        VStack {
          Text(error)
          Button("Retry") { retry += 1 }
        }.frame(maxWidth: .infinity, maxHeight: .infinity)
      } else if picker.items.isEmpty {
        Text(query.isEmpty ? "No files in this folder" : "No matching files")
          .foregroundStyle(.secondary).frame(maxWidth: .infinity, maxHeight: .infinity)
      } else {
        List(picker.items, id: \.self) { item in
          switch item {
          case let .folder(folder):
            Button { folders.append(folder.path)
              query = ""
            } label: {
              Label(folder.name, systemImage: "folder")
            }
          case let .file(item):
            Button {
              select(ComposeAttachment(url: item.value1.fileUrl, fileName: item.value1.name, mediaType: ""))
              dismiss()
            } label: {
              HStack {
                Label(item.value1.name, systemImage: "doc")
                Spacer()
                Text(ByteCountFormatter.string(fromByteCount: Int64(item.value1.size), countStyle: .file))
                  .font(.caption).foregroundStyle(.secondary)
              }
            }
          }
        }
        .buttonStyle(.plain)
      }
    }
    .padding()
    .frame(minWidth: 420, idealWidth: 520, minHeight: 360, idealHeight: 440)
    .task(id: Request(folder: folders.joined(separator: "/"), query: query, retry: retry)) {
      let folder = folders.joined(separator: "/")
      let search = query.trimmingCharacters(in: .whitespacesAndNewlines)
      await picker.load {
        try await Task.sleep(for: .milliseconds(200))
        return try await load(folder, search)
      }
    }
  }

  private struct Request: Equatable {
    let folder: String
    let query: String
    let retry: Int
  }
}

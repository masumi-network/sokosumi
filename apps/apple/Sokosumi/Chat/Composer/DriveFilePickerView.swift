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
      if let error = picker.errorMessage {
        VStack {
          Text(error)
          Button("Retry") { retry += 1 }
        }.frame(maxWidth: .infinity, maxHeight: .infinity)
      } else if picker.items.isEmpty {
        if picker.loading {
          ProgressView("Loading files…").frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
          Text(query.isEmpty ? "No files in this folder" : "No matching files")
            .foregroundStyle(.secondary).frame(maxWidth: .infinity, maxHeight: .infinity)
        }
      } else {
        List(picker.items, id: \.rowID) { item in
          DriveItemRow(item: item, onFolder: { path in
            folders.append(path)
            query = ""
          }, onFile: { attachment in
            select(attachment)
            dismiss()
          })
        }
        .buttonStyle(.plain)
        .disabled(picker.loading)
      }
    }
    .padding()
    .frame(minWidth: 420, idealWidth: 520, minHeight: 360, idealHeight: 440)
    .task(id: Request(folder: folders.joined(separator: "/"), query: query, retry: retry)) {
      let folder = folders.joined(separator: "/")
      let search = query.trimmingCharacters(in: .whitespacesAndNewlines)
      if !search.isEmpty {
        try? await Task.sleep(for: .milliseconds(200))
        guard !Task.isCancelled else { return }
      }
      await picker.load {
        try await load(folder, search)
      }
    }
  }

  private struct Request: Equatable {
    let folder: String
    let query: String
    let retry: Int
  }
}

private struct DriveItemRow: View {
  let item: Components.Schemas.DriveItem
  let onFolder: (String) -> Void
  let onFile: (ComposeAttachment) -> Void

  var body: some View {
    Button(action: activate) {
      HStack {
        Label(name, systemImage: symbol)
        Spacer()
        if let size {
          Text(ByteCountFormatter.string(fromByteCount: size, countStyle: .file))
            .font(.caption).foregroundStyle(.secondary)
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      .contentShape(Rectangle())
    }
  }

  private var name: String {
    switch item {
    case let .folder(folder): folder.name
    case let .file(file): file.value1.name
    }
  }

  private var symbol: String {
    switch item {
    case .folder: "folder"
    case .file: "doc"
    }
  }

  private var size: Int64? {
    switch item {
    case .folder: nil
    case let .file(file): Int64(file.value1.size)
    }
  }

  private func activate() {
    switch item {
    case let .folder(folder): onFolder(folder.path)
    case let .file(file):
      onFile(ComposeAttachment(url: file.value1.fileUrl, fileName: file.value1.name, mediaType: ""))
    }
  }
}

private extension Components.Schemas.DriveItem {
  var rowID: String {
    switch self {
    case let .folder(folder): "folder:\(folder.path)"
    case let .file(file): file.value1.fileUrl
    }
  }
}

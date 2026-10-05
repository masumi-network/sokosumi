import CoreAPI
import SokosumiChat
import SwiftUI

struct DriveFilePickerView: View {
  let load: (String, String) async throws -> [Components.Schemas.DriveItem]
  let select: (ComposeAttachment) -> Void
  /// Whose Files these are, for the root crumb (web `driveWorkspaceRootLabel`); nil reads as the personal workspace.
  var workspace: WorkspaceSession.Option?
  @Environment(\.dismiss) private var dismiss
  @StateObject private var picker = DrivePicker()
  @State private var folders: [String] = []
  @State private var query = ""
  @State private var retry = 0

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      HStack(alignment: .firstTextBaseline) {
        VStack(alignment: .leading, spacing: 2) {
          Text("Select from Files").font(.headline)
          Text("Choose a file from your personal or organization Files").font(.callout).foregroundStyle(.secondary)
        }
        Spacer()
        Button("Cancel") { dismiss() }.keyboardShortcut(.cancelAction)
      }
      HStack {
        Button(DrivePicker.rootTitle(for: workspace), systemImage: isOrganization ? "building.2" : "house") {
          folders = []
          query = ""
        }
        ForEach(crumbs, id: \.path) { crumb in
          Image(systemName: "chevron.right").accessibilityHidden(true)
          Button(crumb.name) {
            folders = crumb.path.split(separator: "/").map(String.init)
            query = ""
          }
        }
      }
      .buttonStyle(.borderless)
      TextField("Search files…", text: $query).textFieldStyle(.roundedBorder)
      if let error = picker.errorMessage {
        VStack {
          Text(error)
          Button("Retry") { retry += 1 }
        }.frame(maxWidth: .infinity, maxHeight: .infinity)
      } else if picker.items.isEmpty {
        if picker.loading {
          ProgressView("Loading files…").frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
          Text(query.isEmpty ? "No files in this folder" : "No files found")
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

  private var isOrganization: Bool {
    workspace?.workspace.organizationId != nil
  }

  private var crumbs: [(path: String, name: String)] {
    folders.enumerated().map { index, name in
      (path: folders.prefix(index + 1).joined(separator: "/"), name: name)
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
      // Web's row: the name over "Folder", or over the file's size and upload day ("Oct 5").
      Label {
        VStack(alignment: .leading, spacing: 2) {
          Text(name).lineLimit(1).truncationMode(.middle)
          detail.font(.caption).foregroundStyle(.secondary)
        }
      } icon: {
        Image(systemName: symbol)
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      .contentShape(Rectangle())
    }
  }

  @ViewBuilder private var detail: some View {
    switch item {
    case .folder:
      Text("Folder")
    case let .file(file):
      HStack(spacing: 8) {
        if file.value1.size > 0 {
          Text(Int64(file.value1.size), format: .byteCount(style: .file))
        }
        Text(file.value1.uploadedAt, format: .dateTime.month(.abbreviated).day())
      }
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

  private func activate() {
    switch item {
    case let .folder(folder): onFolder(folder.path)
    case let .file(file):
      onFile(ComposeAttachment(url: file.value1.fileUrl, fileName: file.value1.name, mediaType: "", size: file.value1.size))
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

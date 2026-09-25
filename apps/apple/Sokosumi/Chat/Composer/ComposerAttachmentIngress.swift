#if os(macOS)
  import AppKit
  import Combine
  import SokosumiChat
  import UniformTypeIdentifiers

  /// Native paste/drop decoding, scoped to the same lifetime as its composer's uploads.
  @MainActor final class ComposerAttachmentIngress: ObservableObject {
    @Published var isTargeted = false
    private(set) var pending: Task<Void, Never>?

    func cancel() {
      pending?.cancel()
      pending = nil
      isTargeted = false
    }

    /// `files` receives container copies. The caller deletes `scratch` when the upload finishes.
    func receive(_ providers: [NSItemProvider], files: @escaping ([URL], URL) -> Void, image: @escaping (Data) -> Void, failure: @escaping (Error) -> Void) {
      guard pending == nil else { return }
      isTargeted = false
      pending = Task {
        var scratch: URL?
        var handedOff = false
        defer {
          if !handedOff, let scratch {
            try? FileManager.default.removeItem(at: scratch)
          }
          if !Task.isCancelled {
            pending = nil
          }
        }
        do {
          let fileProviders = providers.filter { $0.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier) }
          if !fileProviders.isEmpty {
            let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
            scratch = directory
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            var urls: [URL] = []
            for provider in fileProviders {
              try Task.checkCancellation()
              try await urls.append(provider.copyRegularFile(into: directory))
            }
            try Task.checkCancellation()
            handedOff = true
            files(urls, directory)
            return
          }
          if let provider = providers.first(where: { $0.hasItemConformingToTypeIdentifier(UTType.png.identifier) }) {
            let data = try await provider.loadDataRepresentation(for: .png)
            try Task.checkCancellation()
            image(data)
          } else if let provider = providers.first(where: { $0.hasItemConformingToTypeIdentifier(UTType.tiff.identifier) }) {
            let data = try await provider.loadDataRepresentation(for: .tiff)
            try Task.checkCancellation()
            if let bitmap = NSBitmapImageRep(data: data), let png = bitmap.representation(using: .png, properties: [:]) {
              image(png)
            }
          }
        } catch {
          if !Task.isCancelled {
            failure(error)
          }
        }
      }
    }
  }

  private extension NSItemProvider {
    func loadDataRepresentation(for type: UTType) async throws -> Data {
      try await withCheckedThrowingContinuation { continuation in
        loadDataRepresentation(forTypeIdentifier: type.identifier) { data, error in
          if let data {
            continuation.resume(returning: data)
          } else {
            continuation.resume(throwing: error ?? CocoaError(.fileReadUnknown))
          }
        }
      }
    }

    /// Copies a dropped file while its sandbox grant is still on this URL object.
    /// `public.file-url` data is only a path string, and rebuilding a URL from it drops the grant.
    func copyRegularFile(into scratch: URL) async throws -> URL {
      try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<URL, Error>) in
        _ = loadObject(ofClass: URL.self) { url, error in
          do {
            guard let url, url.isFileURL else { throw error ?? CocoaError(.fileReadUnknown) }
            let name = url.lastPathComponent
            guard name != ".", name != "..", !name.isEmpty else { throw AttachmentUpload.Failure.invalidFile }
            let scoped = url.startAccessingSecurityScopedResource()
            defer {
              if scoped {
                url.stopAccessingSecurityScopedResource()
              }
            }
            let values = try url.resourceValues(forKeys: [.isRegularFileKey])
            guard values.isRegularFile == true else { throw AttachmentUpload.Failure.invalidFile }
            let folder = scratch.appendingPathComponent(UUID().uuidString, isDirectory: true)
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            let dest = folder.appendingPathComponent(name)
            try FileManager.default.copyItem(at: url, to: dest)
            continuation.resume(returning: dest)
          } catch {
            continuation.resume(throwing: error)
          }
        }
      }
    }
  }
#endif

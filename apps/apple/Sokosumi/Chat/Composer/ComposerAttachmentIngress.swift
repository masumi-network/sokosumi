#if os(macOS)
  import AppKit
  import Combine
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

    func receive(_ providers: [NSItemProvider], files: @escaping ([URL]) -> Void, image: @escaping (Data) -> Void, failure: @escaping (Error) -> Void) {
      guard pending == nil else { return }
      isTargeted = false
      pending = Task {
        defer {
          if !Task.isCancelled {
            pending = nil
          }
        }
        do {
          var urls: [URL] = []
          for provider in providers where provider.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier) {
            let data = try await provider.loadDataRepresentation(for: .fileURL)
            if let url = URL(dataRepresentation: data, relativeTo: nil), url.isFileURL {
              urls.append(url)
            }
          }
          try Task.checkCancellation()
          if !urls.isEmpty {
            files(urls)
          } else if let provider = providers.first(where: { $0.hasItemConformingToTypeIdentifier(UTType.png.identifier) }) {
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
  }
#endif

import AppKit
import Quartz
import SokosumiAuth
import SokosumiChat
import SokosumiWorkspace
import SwiftUI

/// Loads a result card's protected output (row 38e2). The chat window injects the coordinator's; tests pass a stub.
protocol ResultOutputLoading: Sendable {
  @MainActor func file(_ source: ResultOutputSource, named fileName: String) async throws -> ResultOutputFile
}

/// The coordinator's client and open workspace, as every other chat request.
struct WorkspaceResultOutputLoader: ResultOutputLoading {
  let workspaces: WorkspaceState
  let auth: AuthState

  func file(_ source: ResultOutputSource, named fileName: String) async throws -> ResultOutputFile {
    try await workspaces.resultOutput(source, fileName: fileName, auth: auth)
  }
}

/// Where a loaded output goes: Quick Look for a preview or Open, the save panel for Download. Web opens its own image
/// and document viewers, the browser's player and the browser's download; the Mac's equivalents are these.
protocol ResultOutputPresenting: Sendable {
  @MainActor func preview(_ file: ResultOutputFile)
  /// Returns when the panel closes; throws when the copy fails.
  @MainActor func save(_ file: ResultOutputFile) async throws
}

struct SystemResultOutputPresenter: ResultOutputPresenting {
  func preview(_ file: ResultOutputFile) {
    ResultOutputQuickLook.shared.show(file)
  }

  func save(_ file: ResultOutputFile) async throws {
    let panel = NSSavePanel()
    panel.nameFieldStringValue = file.url.lastPathComponent
    panel.canCreateDirectories = true
    let response = if let window = NSApp.keyWindow {
      await panel.beginSheetModal(for: window)
    } else {
      await panel.begin()
    }
    guard response == .OK, let destination = panel.url else { return }
    // The panel already asked before replacing an existing file.
    if FileManager.default.fileExists(atPath: destination.path) {
      try FileManager.default.removeItem(at: destination)
    }
    try FileManager.default.copyItem(at: file.url, to: destination)
  }
}

/// The shared Quick Look panel over one loaded output, kept alive while the panel can show it.
@MainActor private final class ResultOutputQuickLook: NSObject, QLPreviewPanelDataSource {
  static let shared = ResultOutputQuickLook()
  private var file: ResultOutputFile?

  func show(_ file: ResultOutputFile) {
    self.file = file
    guard let panel = QLPreviewPanel.shared() else { return }
    panel.dataSource = self
    panel.reloadData()
    panel.makeKeyAndOrderFront(nil)
  }

  func numberOfPreviewItems(in _: QLPreviewPanel!) -> Int {
    file == nil ? 0 : 1
  }

  func previewPanel(_: QLPreviewPanel!, previewItemAt _: Int) -> (any QLPreviewItem)! {
    file?.url as NSURL?
  }
}

extension EnvironmentValues {
  /// Nil outside a signed-in chat window: every output then opens on web, as before row 38e2.
  @Entry var resultOutputLoader: (any ResultOutputLoading)?
  /// Where a loaded output goes; tests pass a recorder.
  @Entry var resultOutputPresenter: any ResultOutputPresenting = SystemResultOutputPresenter()
}

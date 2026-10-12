import CoreAPI
import SokosumiChat
import SwiftUI

/// The String Catalog for a Soko Bot message's result cards (`ChatResults.xcstrings`, web `Components.ChatResults`).
let chatResultsTable = "ChatResults"

/// Web `ResultPreviews` under a Soko Bot message (row 38e1): reads the cards this viewer may see whenever the row
/// appears, says so while it reads or when the read failed, draws the cards, then the turn's footer.
struct MessageResultPreviewsView: View {
  let descriptorIds: [String]
  /// The settled turn whose approvals and Task buttons follow the cards (row 38's footer), if it has any.
  let footer: SokoBotTurnMetadata?
  let load: () async throws -> [Components.Schemas.ChatResultPreview]
  /// Answers a project question card (row 38h1): the card's id and the picked project's.
  var select: ((String, String) async throws -> Void)?
  /// Accepts or rejects a decision card's decision (row 38h2): the decision's id and the resolution.
  var resolveDecision: ((String, SokoBotDecision.Resolution) async throws -> Void)?
  @State private var state: ResultPreviewsLoad = .loading
  @State private var attempt = 0

  /// A new descriptor list (a completion update) or a Retry reads again, as web's query key and `refetch`.
  private struct ReadKey: Equatable {
    let descriptorIds: [String]
    let attempt: Int
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      switch state {
      case .loading:
        Text("Loading results…", tableName: chatResultsTable, comment: "While a message's result cards load.")
          .font(.caption)
          .foregroundStyle(.secondary)
      case .failed:
        HStack(spacing: 8) {
          Text("Results could not be loaded", tableName: chatResultsTable, comment: "When a message's result cards failed to load.")
          Button {
            attempt += 1
          } label: {
            Text("Retry", tableName: chatResultsTable, comment: "Reads a message's result cards again.")
          }
          .buttonStyle(.borderless)
        }
        .font(.caption)
        .foregroundStyle(.secondary)
      case let .loaded(items):
        ForEach(items) { item in
          ResultPreviewCardView(item: item, select: select, resolveDecision: resolveDecision.map { resolve in
            { decisionId, resolution in
              try await resolve(decisionId, resolution)
              // Web refetches the row's results, so the card shows the settled decision.
              attempt += 1
            }
          })
        }
      }
      if let footer, footer.pendingDecisionCount > 0 || !footer.footerTaskIds(excluding: previewedTaskIds).isEmpty {
        SokoBotMessageFooterView(turn: footer, previewedTaskIds: previewedTaskIds)
      }
    }
    .task(id: ReadKey(descriptorIds: descriptorIds, attempt: attempt)) {
      state = .loading
      do {
        let previews = try await load()
        guard !Task.isCancelled else { return }
        state = .loaded(MessageResultPreviews.items(previews, descriptorIds: descriptorIds, webBaseURL: CoreSettings.webBaseURL))
      } catch {
        guard !Task.isCancelled else { return }
        state = .failed
      }
    }
  }

  /// Web keeps every Task button while the cards load or after the read failed.
  private var previewedTaskIds: Set<String> {
    if case let .loaded(items) = state {
      MessageResultPreviews.previewedTaskIds(items)
    } else {
      []
    }
  }
}

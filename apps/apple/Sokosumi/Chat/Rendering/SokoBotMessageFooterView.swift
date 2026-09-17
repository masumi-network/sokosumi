import SokosumiAuth
import SokosumiChat
import SokosumiWorkspace
import SwiftUI

/// Under a settled Soko Bot reply (web `SokoBotMessageFooter`): the approvals
/// the turn waits on, the owner's useful / not useful rating and the Tasks it
/// created. Links open on web; the rating goes through the coordinator so
/// "Thanks, noted." survives scrolling.
struct SokoBotMessageFooterView: View {
  let turn: SokoBotTurnMetadata
  @EnvironmentObject private var workspaces: WorkspaceState
  @EnvironmentObject private var auth: AuthState

  var body: some View {
    SokoBotMessageFooterContent(
      turn: turn,
      feedback: workspaces.sokoBotFeedback(forTurn: turn.turnId),
      isSendingFeedback: workspaces.isSendingSokoBotFeedback(forTurn: turn.turnId)
    ) { useful in
      // Web ignores a rejected rating: the thumbs return and can be tapped again.
      Task { @MainActor in try? await workspaces.sendSokoBotFeedback(turnId: turn.turnId, useful: useful, auth: auth) }
    }
  }
}

/// The footer's chips and thumbs, free of coordinator state so fixtures can render every state.
struct SokoBotMessageFooterContent: View {
  let turn: SokoBotTurnMetadata
  var feedback: Bool?
  var isSendingFeedback = false
  var onFeedback: ((Bool) -> Void)?
  @Environment(\.openURL) private var openURL

  var body: some View {
    WrappingRow(spacing: 8) {
      if turn.pendingDecisionCount > 0, let url = turn.assistantURL(webBaseURL: CoreSettings.webBaseURL) {
        FooterChip(accented: true) { openURL(url) } label: {
          Image(systemName: "checkmark.shield").foregroundStyle(Color.accentColor)
          Text(turn.pendingDecisionCount == 1 ? "1 approval waiting" : "\(turn.pendingDecisionCount) approvals waiting").fontWeight(.medium)
          Text("Review on the assistant page").foregroundStyle(.secondary)
          Image(systemName: "arrow.up.right").font(.caption2)
        }
        .help("Review on the assistant page")
      }
      feedbackControls
      ForEach(turn.taskIds, id: \.self) { taskId in
        if let url = SokoBotTurnMetadata.taskURL(taskId: taskId, webBaseURL: CoreSettings.webBaseURL) {
          FooterChip { openURL(url) } label: {
            Circle().fill(Color.accentColor).frame(width: 6, height: 6)
            Text("Task").fontWeight(.medium)
            Image(systemName: "arrow.up.right").font(.caption2)
          }
          .help("Open the task on web")
          .accessibilityLabel("Task")
        }
      }
    }
    .font(.caption)
    .padding(.top, 2)
  }

  @ViewBuilder
  private var feedbackControls: some View {
    if let feedback {
      HStack(spacing: 6) {
        Image(systemName: feedback ? "hand.thumbsup" : "hand.thumbsdown").font(.caption2)
        Text("Thanks, noted.")
      }
      .foregroundStyle(.secondary)
      .accessibilityElement(children: .combine)
    } else {
      HStack(spacing: 2) {
        Text("Useful?").padding(.trailing, 2)
        feedbackButton("Useful", symbol: "hand.thumbsup", useful: true)
        feedbackButton("Not useful", symbol: "hand.thumbsdown", useful: false)
      }
      .foregroundStyle(.secondary)
    }
  }

  private func feedbackButton(_ title: String, symbol: String, useful: Bool) -> some View {
    Button { onFeedback?(useful) } label: {
      Image(systemName: symbol)
        .frame(width: 20, height: 20)
        .contentShape(.rect)
    }
    .buttonStyle(.borderless)
    .disabled(isSendingFeedback || onFeedback == nil)
    .help(title)
    .accessibilityLabel(title)
  }
}

/// Bordered chip like web's footer links: a card border that tints on hover.
private struct FooterChip<Content: View>: View {
  var accented = false
  let action: () -> Void
  @ViewBuilder let label: () -> Content
  @State private var hovered = false

  var body: some View {
    Button(action: action) {
      HStack(spacing: 6, content: label)
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(hovered ? Color.primary.opacity(0.04) : .clear, in: .rect(cornerRadius: 6))
        .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(accented ? Color.accentColor.opacity(0.4) : Color.primary.opacity(hovered ? 0.2 : 0.12)))
        .contentShape(.rect)
    }
    .buttonStyle(.plain)
    .onHover { hovered = $0 }
  }
}

/// Hover badge beside a message one assistant wrote to another (web
/// `SokoBotChainBadge`): the hop count, with the limits in the tooltip.
struct SokoBotChainBadge: View {
  let chain: SokoBotChainMetadata

  var body: some View {
    HStack(spacing: 4) {
      Image(systemName: "repeat")
      Text(chain.label).monospacedDigit()
    }
    .font(.caption)
    .foregroundStyle(.secondary)
    .padding(.horizontal, 6)
    .padding(.vertical, 3)
    .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(Color.primary.opacity(0.12)))
    .help(chain.summary)
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(chain.summary)
  }
}

/// Left-aligned rows that wrap at the proposed width, like web `flex-wrap`.
private struct WrappingRow: Layout {
  var spacing: CGFloat = 8

  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache _: inout ()) -> CGSize {
    let rows = arrange(proposal: proposal, subviews: subviews)
    let width = rows.map(\.width).max() ?? 0
    let height = rows.reduce(0) { $0 + $1.height } + CGFloat(max(0, rows.count - 1)) * spacing
    return CGSize(width: proposal.width ?? width, height: height)
  }

  func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache _: inout ()) {
    var top = bounds.minY
    for row in arrange(proposal: proposal, subviews: subviews) {
      var leading = bounds.minX
      for index in row.indices {
        let size = subviews[index].sizeThatFits(.unspecified)
        subviews[index].place(at: CGPoint(x: leading, y: top + (row.height - size.height) / 2), proposal: .unspecified)
        leading += size.width + spacing
      }
      top += row.height + spacing
    }
  }

  private struct Row {
    var indices: [Int] = []
    var width: CGFloat = 0
    var height: CGFloat = 0
  }

  private func arrange(proposal: ProposedViewSize, subviews: Subviews) -> [Row] {
    let limit = proposal.width ?? .infinity
    var rows: [Row] = []
    var current = Row()
    for (index, subview) in subviews.enumerated() {
      let size = subview.sizeThatFits(.unspecified)
      let needed = current.indices.isEmpty ? size.width : current.width + spacing + size.width
      if !current.indices.isEmpty, needed > limit {
        rows.append(current)
        current = Row()
      }
      current.indices.append(index)
      current.width = current.indices.count == 1 ? size.width : current.width + spacing + size.width
      current.height = max(current.height, size.height)
    }
    if !current.indices.isEmpty {
      rows.append(current)
    }
    return rows
  }
}

import CoreAPI
import SokosumiAuth
import SokosumiChat
import SokosumiWorkspace
import SwiftUI

/// Shared by room and reply-thread rows, including their streamed overlays.
struct MessageMarkdownView: View {
  let source: String
  var room: Components.Schemas.ChatRoom?
  var channels: [ComposerChannel] = []
  var preparedDocument: MessageMarkdown?
  @EnvironmentObject private var workspaces: WorkspaceState
  @Environment(\.openURL) private var openURL
  @EnvironmentObject private var auth: AuthState
  @State private var selectedProfile: ChatParticipantProfile?
  var body: some View {
    MessageMarkdownContent(source: source, room: room, channels: channels, preparedDocument: preparedDocument)
      .textSelection(.enabled)
      .frame(maxWidth: .infinity, alignment: .leading)
      .environment(\.openURL, OpenURLAction { url in
        if url.scheme == "sokosumi-channel" {
          if let id = MessageChannels.roomId(for: url, channels: workspaces.composerChannels) {
            Task { @MainActor in
              workspaces.selectRoom(id, auth: auth)
            }
          }
          return .handled
        }
        guard url.scheme == "sokosumi-participant" else {
          openURL(url)
          return .handled
        }
        if let room {
          selectedProfile = ChatParticipantProfile.resolving(url, in: room)
        }
        return .handled
      })
      .popover(item: $selectedProfile) { ParticipantDetailsView(profile: $0) }
  }
}

private struct MessageMarkdownContent: View {
  let source: String
  var room: Components.Schemas.ChatRoom?
  var channels: [ComposerChannel]
  var preparedDocument: MessageMarkdown?
  private struct RenderInput: Hashable {
    let source: String
    let mentions: MessageMentions?
    let channels: [ComposerChannel]
  }

  @State private var document: MessageMarkdown?
  @ScaledMetric(relativeTo: .body) private var emojiBaseSize = 16.0

  private func emojiSize(_ count: Int) -> Double {
    switch count {
    case 1: emojiBaseSize * 2.25
    case 2 ... 3: emojiBaseSize * 1.875
    case 4 ... 6: emojiBaseSize * 1.5
    default: emojiBaseSize * 1.25
    }
  }

  var body: some View {
    Group {
      if let count = jumboEmojiCount(source) {
        Text(source.trimmingCharacters(in: .whitespacesAndNewlines)).font(.system(size: emojiSize(count)))
      } else if let document = preparedDocument ?? document {
        ExpandableMessageBody(source: source, clampHeight: document.clampsLongBody) {
          VStack(alignment: .leading, spacing: 8) {
            ForEach(document.segments) { segment in
              if segment.files.isEmpty {
                MarkdownBlocksView(blocks: segment.blocks)
              } else if segment.usesLargeImage, let file = segment.files.first {
                MessageAttachmentView(attachment: file.attachment).id(file.attachment.url)
              } else {
                WrappingRow(alignment: .top, constrainsWidth: true) {
                  ForEach(segment.files) { file in
                    MessageAttachmentView(attachment: file.attachment, compact: true).id(file.attachment.url)
                  }
                }
                .padding(.bottom, segment.files.last?.attachment.kind == .file ? 8 : 0)
              }
            }
          }
        }
        .messageImageGallery(document.imageGallery)
      } else {
        ProgressView()
          .controlSize(.small)
          .accessibilityLabel("Loading message")
      }
    }
    .task(id: RenderInput(source: source, mentions: room.map(MessageMentions.init), channels: channels)) {
      guard preparedDocument == nil else { return }
      let source = source
      let channels = channels
      let mentions = room.map(MessageMentions.init)
      let baseURL = CoreSettings.webBaseURL
      let parsed = await Task.detached(priority: .userInitiated) {
        MessageMarkdown(source, baseURL: baseURL, mentions: mentions, channels: channels)
      }.value
      guard !Task.isCancelled else { return }
      document = parsed
    }
  }
}

struct MarkdownBlocksView: View {
  let blocks: [MessageMarkdownBlock]
  var presentsFileAttachments = true

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      ForEach(blocks) { block in
        MarkdownBlockView(block: block, presentsFileAttachments: presentsFileAttachments)
      }
    }
  }
}

private struct MarkdownBlockView: View {
  let block: MessageMarkdownBlock
  var presentsFileAttachments = true

  var body: some View {
    switch block.kind {
    case let .header(level):
      attachmentContent(block.text)
        .fixedSize(horizontal: false, vertical: true)
        .font(headingFont(level))
        .fontWeight(.semibold)
        .accessibilityAddTraits(.isHeader)
    case .orderedList:
      list(ordered: true)
    case .unorderedList:
      list(ordered: false)
    case .blockQuote:
      HStack(alignment: .top, spacing: 10) {
        Rectangle().fill(.secondary.opacity(0.4)).frame(width: 3)
        MarkdownBlocksView(blocks: block.children, presentsFileAttachments: presentsFileAttachments)
      }
      .fixedSize(horizontal: false, vertical: true)
      .foregroundStyle(.secondary)
    case .thematicBreak:
      Divider().padding(.vertical, 4)
    case let .codeBlock(languageHint):
      MessageCodeBlock(source: String(block.text.characters), languageHint: languageHint)
    case let .table(columns):
      ScrollView(.horizontal) {
        Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 8) {
          ForEach(block.children) { row in
            GridRow {
              ForEach(row.children) { cell in
                attachmentContent(cell.text)
                  .fontWeight(row.kind == .tableHeaderRow ? .semibold : .regular)
                  .gridColumnAlignment(tableAlignment(columnAlignment(for: cell, in: columns)))
              }
            }
          }
        }
        .padding(10)
      }
      .overlay {
        RoundedRectangle(cornerRadius: 6).stroke(.secondary.opacity(0.3))
      }
    default:
      if block.children.isEmpty {
        attachmentContent(block.text)
      } else {
        MarkdownBlocksView(blocks: block.children, presentsFileAttachments: presentsFileAttachments)
      }
    }
  }

  private func attachmentContent(_ text: AttributedString) -> some View {
    let segments = MessageAttachmentSegment.split(text, includeFileAttachments: presentsFileAttachments).filter { segment in
      segment.attachment != nil
        || !String(segment.text.characters).trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
    return VStack(alignment: .leading, spacing: 8) {
      ForEach(segments) { segment in
        if let attachment = segment.attachment {
          MessageAttachmentView(attachment: attachment).id(attachment.url)
        } else {
          Text(styled(segment.text)).fixedSize(horizontal: false, vertical: true)
        }
      }
    }
    .padding(.bottom, presentsFileAttachments && segments.last?.attachment?.kind == .file ? 8 : 0)
  }

  private func styled(_ text: AttributedString) -> AttributedString {
    var result = text
    for run in text.runs {
      if run[MessageUnderlineAttribute.self] == true {
        result[run.range].underlineStyle = .single
      }
      if run[MessageMentionAttribute.self] == true {
        result[run.range].foregroundColor = .accentColor
      }
    }
    return result
  }

  private func list(ordered: Bool) -> some View {
    VStack(alignment: .leading, spacing: 4) {
      ForEach(block.children) { item in
        HStack(alignment: .firstTextBaseline, spacing: 8) {
          if let checked = item.taskChecked {
            Image(systemName: checked ? "checkmark.square.fill" : "square")
              .accessibilityLabel(checked ? "Completed task" : "Incomplete task")
          } else if ordered, case let .listItem(ordinal) = item.kind {
            Text("\(ordinal).").monospacedDigit()
          } else {
            Text("•")
          }
          MarkdownBlocksView(blocks: item.children, presentsFileAttachments: presentsFileAttachments)
        }
      }
    }
  }

  private func headingFont(_ level: Int) -> Font {
    switch level {
    case 1: .title
    case 2: .title2
    case 3: .title3
    case 4: .headline
    case 5: .subheadline
    default: .footnote
    }
  }

  private func columnAlignment(
    for cell: MessageMarkdownBlock,
    in columns: [PresentationIntent.TableColumn]
  ) -> PresentationIntent.TableColumn.Alignment {
    guard case let .tableCell(columnIndex) = cell.kind,
          columns.indices.contains(columnIndex)
    else {
      return .left
    }
    return columns[columnIndex].alignment
  }

  private func tableAlignment(_ alignment: PresentationIntent.TableColumn.Alignment) -> HorizontalAlignment {
    switch alignment {
    case .left: .leading
    case .center: .center
    case .right: .trailing
    @unknown default: .leading
    }
  }
}

#Preview("Report formatting") {
  MessageMarkdownView(source: """
  ### Operational report

  Finished **analysis** with _results_.

  1. Acquisition
     - **New users:** 20
     - **Organizations:** 4
  2. Engagement

  > Results cover the previous seven days.

  | Metric | Value |
  | :--- | ---: |
  | Messages | 2,340 |

  ```swift
  let greeting = "Hello 👋"
  ```
  """)
  .padding()
  .frame(width: 600)
}

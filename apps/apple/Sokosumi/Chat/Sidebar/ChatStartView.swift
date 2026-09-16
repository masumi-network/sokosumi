import SokosumiChat
import SwiftUI

/// The first message belongs to the room composer, after the Direct opens.
struct ChatStartView: View {
  let load: () async throws -> DirectRecipientRoster
  let open: (DirectConversationSelection) async throws -> Bool
  @StateObject private var picker = DirectRecipientPicker(hasOrganization: false)
  @State private var retry = 0

  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      Text("Start a chat").font(.largeTitle).fontWeight(.semibold)
      Text("Choose an AI coworker to start a conversation.").foregroundStyle(.secondary)
      content
      if let error = picker.creationError {
        Text(error).foregroundStyle(.red).fixedSize(horizontal: false, vertical: true)
      }
      Button {
        Task { @MainActor in _ = await picker.create(using: open) }
      } label: {
        HStack(spacing: 8) {
          if picker.creating {
            ProgressView().controlSize(.small)
          }
          Text(picker.creating ? "Opening…" : "Start chat")
        }
      }
      .buttonStyle(.borderedProminent)
      .keyboardShortcut(.defaultAction)
      .disabled(picker.loading || picker.creating || picker.errorMessage != nil || picker.selectedTargets.isEmpty)
    }
    .padding(24)
    .frame(maxWidth: 560, maxHeight: 520)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .navigationTitle("Chat")
    .task(id: retry) {
      await picker.load(using: load)
      if picker.selectedTargets.isEmpty, let first = picker.roster.rankedCoworkers.first {
        picker.add(first)
      }
    }
  }

  @ViewBuilder
  private var content: some View {
    if picker.loading {
      ProgressView("Loading coworkers…").frame(maxWidth: .infinity, maxHeight: .infinity)
    } else if let error = picker.errorMessage {
      ContentUnavailableView {
        Label("Couldn’t load coworkers", systemImage: "exclamationmark.triangle")
      } description: {
        Text(error)
      } actions: {
        Button("Retry") { retry += 1 }
      }
    } else if picker.roster.rankedCoworkers.isEmpty {
      ContentUnavailableView("No coworkers available", systemImage: "person.crop.circle.badge.questionmark",
                             description: Text("No AI coworkers are available for chat in this workspace."))
    } else {
      List(selection: Binding(
        get: { picker.selection.recipients.first },
        set: { id in
          guard let target = picker.roster.targets.first(where: { $0.id == id }) else { return }
          Task { @MainActor in picker.add(target) }
        }
      )) {
        ForEach(picker.roster.rankedCoworkers) { target in
          HStack(spacing: 10) {
            ParticipantAvatar(imageURL: target.imageURL, name: target.name, size: 32)
              .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
              Text(target.name).lineLimit(1)
              if let caption = target.caption, !caption.isEmpty {
                Text(caption).font(.caption).foregroundStyle(.secondary).lineLimit(2)
              }
            }
            Spacer(minLength: 0)
          }
          .padding(.vertical, 6)
          .tag(target.id)
          .listRowSeparator(.hidden)
          .listRowInsets(EdgeInsets(top: 2, leading: 0, bottom: 2, trailing: 0))
        }
      }
      .listStyle(.plain)
      .contentMargins(0, for: .scrollContent)
      .disabled(picker.creating)
    }
  }
}

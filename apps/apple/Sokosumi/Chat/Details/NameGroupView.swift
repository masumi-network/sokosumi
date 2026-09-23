import CoreAPI
import SokosumiChat
import SwiftUI

/// Web's "Name this group" dialog: one field shared by every member; an empty name shows the members again.
struct NameGroupView: View {
  let save: (GroupNameDraft) async throws -> Bool

  @StateObject private var model: GroupNaming
  @State private var saveFailed = false
  @FocusState private var nameFocused: Bool
  @Environment(\.dismiss) private var dismiss

  init(room: Components.Schemas.ChatRoom, model: GroupNaming? = nil, save: @escaping (GroupNameDraft) async throws -> Bool) {
    self.save = save
    _model = StateObject(wrappedValue: model ?? GroupNaming(room: room))
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      Text("Name this group", tableName: groupNameTable, comment: "Title of the sheet that names a group Direct.")
        .font(.title2).fontWeight(.semibold)
      Text("Everyone in the group sees this name instead of the member list. Leave it empty to show the members again.",
           tableName: groupNameTable, comment: "Explains a group Direct's shared name in the Name Group sheet.")
        .foregroundStyle(.secondary)
        .fixedSize(horizontal: false, vertical: true)
      TextField(text: Binding(get: { model.draft.name }, set: { model.draft.setName($0) })) {
        Text("Group name", tableName: groupNameTable, comment: "Label of the group Direct name field.")
      }
      .focused($nameFocused)
      .onSubmit(submit)
      if let error = model.errorMessage {
        Text(error).foregroundStyle(.red).font(.callout)
      } else if saveFailed {
        Text("Could not name the group.", tableName: groupNameTable, comment: "Shown when naming a group Direct fails.")
          .foregroundStyle(.red).font(.callout)
      }
      HStack {
        Spacer()
        Button { dismiss() } label: {
          Text("Cancel", tableName: groupNameTable, comment: "Closes the Name Group sheet without saving.")
        }
        .keyboardShortcut(.cancelAction)
        Button(action: submit) {
          if model.saving {
            Text("Saving…", tableName: groupNameTable, comment: "Save button while a group Direct name is being saved.")
          } else {
            Text("Save", tableName: groupNameTable, comment: "Saves a group Direct's name.")
          }
        }
        .keyboardShortcut(.defaultAction)
        .disabled(!model.canSave)
      }
    }
    .padding(20)
    .frame(width: 420)
    .disabled(model.saving)
    .interactiveDismissDisabled(model.saving)
    .onAppear { nameFocused = true }
  }

  private func submit() {
    guard model.canSave else { return }
    saveFailed = false
    Task {
      if await model.save(using: save) {
        dismiss()
      } else if model.errorMessage == nil {
        saveFailed = true
      }
    }
  }
}

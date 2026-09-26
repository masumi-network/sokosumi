import CoreAPI
import SokosumiChat
import SwiftUI

/// Coordinator hooks for the guest section; `EditChannelSheet` fills them from `WorkspaceState`.
struct GuestAccessActions {
  let load: () async throws -> GuestAccessSnapshot
  let invite: (String) async throws -> Components.Schemas.ChatRoomInvitation
  let revokeInvitation: (String) async throws -> Void
  let createLink: (GuestInviteLinkOptions) async throws -> Components.Schemas.ChatRoomGuestInviteLink
  let revokeLink: (String) async throws -> Void
  let removeGuest: (String) async throws -> Bool
}

/// Web `guest-invite-section.tsx` inside the channel settings dialog: invite by email with the pending list, shareable
/// links with expiry and max-uses presets, and the current guests. Rows act one at a time; Core's messages show inline
/// where web toasts them, and the clipboard is the only app-side concern.
struct GuestAccessSection: View {
  let actions: GuestAccessActions
  @StateObject private var model: GuestAccess
  @State private var retry = 0
  @State private var notice: String?

  init(room: Components.Schemas.ChatRoom, model: GuestAccess? = nil, actions: GuestAccessActions) {
    self.actions = actions
    _model = StateObject(wrappedValue: model ?? GuestAccess(room: room))
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      Divider()
      VStack(alignment: .leading, spacing: 4) {
        Label("Invite guests", systemImage: "person.badge.plus").font(.headline)
        Text("Guests join this channel only and do not become organization members.").font(.caption).foregroundStyle(.secondary)
      }
      emailInvite
      shareableLinks
      guests
      if let error = model.errorMessage {
        Text(error).font(.callout).foregroundStyle(.red)
      }
      // A copy or create notice must show even beside an earlier Core error.
      if let notice {
        Text(notice).font(.callout).foregroundStyle(.secondary)
      }
    }
    .task(id: retry) { await model.load(using: actions.load) }
  }

  private var emailInvite: some View {
    GroupBox {
      VStack(alignment: .leading, spacing: 8) {
        Text("Invite by email").fontWeight(.medium)
        Text("Send a personal invite to a known email address. They must accept with that account.")
          .font(.caption).foregroundStyle(.secondary)
        HStack {
          // A verbatim prompt: the localized-key initializer would Markdown-autolink the address.
          TextField("Email", text: $model.email, prompt: Text(verbatim: "guest@example.com"))
            .labelsHidden()
            .textContentType(.emailAddress)
            .onSubmit(sendInvite)
            .disabled(model.sendingInvite)
          Button(model.sendingInvite ? "Sending…" : "Send invite", action: sendInvite).disabled(!model.canSendInvite)
        }
        caption("Pending invitations")
        if model.loading {
          loadingRow
        } else if model.loadFailed {
          HStack {
            Text("Could not load invitations.").foregroundStyle(.secondary)
            Button("Retry") { retry += 1 }
          }
        } else if model.invitations.isEmpty {
          Text("No pending invitations.").foregroundStyle(.secondary)
        } else {
          ForEach(model.invitations, id: \.id) { invitation in
            HStack(spacing: 4) {
              Text(invitation.email).lineLimit(1).truncationMode(.middle)
              Spacer(minLength: 0)
              revokeButton(busy: model.revokingInvitationId == invitation.id, help: "Revoke invitation", label: "Revoke invitation for \(invitation.email)") {
                Task { await model.revokeInvitation(invitation.id, using: actions.revokeInvitation) }
              }
            }
          }
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    }
  }

  private var shareableLinks: some View {
    GroupBox {
      VStack(alignment: .leading, spacing: 8) {
        Label("Shareable link", systemImage: "link").fontWeight(.medium)
        Text("Create a link anyone signed in outside your organization can open to join as a guest. No email needed up front.")
          .font(.caption).foregroundStyle(.secondary)
        HStack {
          Picker("Expires", selection: $model.linkOptions.expiresInDays) {
            ForEach(GuestInviteLinkOptions.expiryPresets, id: \.self) { days in
              Text(days.map { "\($0) \($0 == 1 ? "day" : "days")" } ?? "No expiry").tag(days)
            }
          }
          .fixedSize()
          Picker("Max uses", selection: $model.linkOptions.maxUses) {
            ForEach(GuestInviteLinkOptions.maxUsesPresets, id: \.self) { uses in
              Text(uses.map { "\($0) \($0 == 1 ? "use" : "uses")" } ?? "Unlimited").tag(uses)
            }
          }
          .fixedSize()
          Spacer(minLength: 0)
        }
        .disabled(model.creatingLink)
        Button(model.creatingLink ? "Creating…" : "Create link", systemImage: "link", action: createLink)
          .disabled(model.creatingLink)
        if model.loading {
          loadingRow
        } else if model.links.isEmpty {
          Text("No shareable links yet.").foregroundStyle(.secondary)
        } else {
          ForEach(model.links, id: \.token) { link in
            linkRow(link)
          }
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    }
  }

  private func linkRow(_ link: Components.Schemas.ChatRoomGuestInviteLink) -> some View {
    VStack(alignment: .leading, spacing: 2) {
      HStack(spacing: 4) {
        Text(link.url).font(.callout.monospaced()).lineLimit(1).truncationMode(.middle).textSelection(.enabled).help(link.url)
        Spacer(minLength: 0)
        Button {
          copy(link.url, notice: "Link copied.")
        } label: {
          Image(systemName: "doc.on.doc")
        }
        .buttonStyle(.borderless)
        .help("Copy link")
        .accessibilityLabel("Copy invite link")
        revokeButton(busy: model.revokingLinkToken == link.token, help: "Revoke link", label: "Revoke invite link") {
          Task { await model.revokeLink(link.token, using: actions.revokeLink) }
        }
      }
      Text("\(expiry(of: link)) · \(link.usageSummary)").font(.caption).foregroundStyle(.secondary)
    }
  }

  private var guests: some View {
    VStack(alignment: .leading, spacing: 6) {
      caption("Guests")
      if model.guests.isEmpty {
        Text("No guests yet.").foregroundStyle(.secondary)
      } else {
        ForEach(model.guests, id: \.id) { guest in
          let name = guest.name.trimmingCharacters(in: .whitespacesAndNewlines)
          let label = name.isEmpty ? guest.email : name
          HStack(spacing: 4) {
            Text("\(Text(verbatim: label))\(Text(verbatim: name.isEmpty ? "" : " (\(guest.email))").foregroundStyle(.secondary))")
              .lineLimit(1).truncationMode(.middle)
            Spacer(minLength: 0)
            revokeButton(busy: model.removingGuestId == guest.id, help: "Remove guest", label: "Remove guest \(label)") {
              Task { await model.removeGuest(guest.id, using: actions.removeGuest) }
            }
          }
        }
      }
    }
  }

  private var loadingRow: some View {
    HStack(spacing: 6) {
      ProgressView().controlSize(.small)
      Text("Loading invitations…").foregroundStyle(.secondary)
    }
  }

  private func caption(_ title: String) -> some View {
    Text(title).font(.caption).fontWeight(.medium).foregroundStyle(.secondary).textCase(.uppercase)
  }

  /// Web's trash icon: a spinner replaces it while that row's request runs and the row stays put until Core answers.
  private func revokeButton(busy: Bool, help: String, label: String, action: @escaping () -> Void) -> some View {
    Button {
      notice = nil
      action()
    } label: {
      if busy {
        ProgressView().controlSize(.small)
      } else {
        Image(systemName: "trash")
      }
    }
    .buttonStyle(.borderless)
    .disabled(busy)
    .help(help)
    .accessibilityLabel(label)
  }

  private func expiry(of link: Components.Schemas.ChatRoomGuestInviteLink) -> String {
    link.expiresAt.map { "Expires \($0.formatted(date: .abbreviated, time: .omitted))" } ?? "No expiry"
  }

  private func sendInvite() {
    notice = nil
    Task { await model.invite(using: actions.invite) }
  }

  /// Web copies the new link right away and says so; a clipboard refusal still reports the creation.
  private func createLink() {
    notice = nil
    Task {
      if let link = await model.createLink(using: actions.createLink) {
        notice = PlatformPasteboard.copy(link.url) ? "Invite link created and copied." : "Invite link created."
      }
    }
  }

  private func copy(_ url: String, notice copied: String) {
    notice = PlatformPasteboard.copy(url) ? copied : "Could not copy link."
  }
}

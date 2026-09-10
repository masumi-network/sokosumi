import CoreAPI
import SokosumiAuth
import SokosumiChat
import SwiftUI

#if os(macOS)
  /// Centered day pill ("Today", "Yesterday", weekday, dd/mm/yyyy),
  /// like web `DaySeparator`.
  struct DaySeparatorRow: View {
    let label: String

    var body: some View {
      HStack {
        Spacer()
        Text(label)
          .font(.caption)
          .fontWeight(.medium)
          .foregroundStyle(.secondary)
          .padding(.horizontal, 12)
          .padding(.vertical, 4)
          .background(Color.secondary.opacity(0.15))
          .clipShape(.capsule)
        Spacer()
      }
      .padding(.vertical, 4)
      .frame(maxWidth: .infinity)
    }
  }

  /// Centered join/leave status, like web `MembershipStatusRow`.
  struct MembershipStatusRow: View {
    let text: String

    var body: some View {
      Text(text)
        .font(.caption)
        .foregroundStyle(.secondary)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 8)
    }
  }

#endif

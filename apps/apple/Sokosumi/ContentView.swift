import CoreAPI
import SwiftUI

struct ContentView: View {
  @State private var status = "Calling Core…"

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      Text("Sokosumi")
        .font(.title)
      Text("Core: \(CoreSettings.baseURL.absoluteString)")
        .font(.caption)
        .foregroundStyle(.secondary)
      Text(status)
        .textSelection(.enabled)
    }
    .padding(24)
    .frame(minWidth: 420, minHeight: 180, alignment: .topLeading)
    .task { await probeCore() }
  }

  private func probeCore() async {
    do {
      let response = try await Client.connecting(to: CoreSettings.baseURL)
        .getUsersId(path: .init(id: "me"))
      switch response {
      case .unauthorized(let unauthorized):
        let payload = try unauthorized.body.json
        status = "Unauthorized as expected: \(payload.message)"
      default:
        status = "Expected 401, got \(String(describing: response))"
      }
    } catch {
      status = "Core call failed: \(error.localizedDescription)"
    }
  }
}

#Preview {
  ContentView()
}

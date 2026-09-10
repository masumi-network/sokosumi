import SokosumiChat
import SwiftUI

#if os(macOS)
  struct ComposerLinkEditor: View {
    @Environment(\.dismiss) private var dismiss
    @State private var text: String
    @State private var url: String
    @FocusState private var urlFocused: Bool
    let save: (String, String) -> Void

    init(text: String, url: String, save: @escaping (String, String) -> Void) {
      _text = State(initialValue: text)
      _url = State(initialValue: url)
      self.save = save
    }

    var body: some View {
      VStack(alignment: .leading, spacing: 16) {
        Text("Link").font(.headline)
        Form {
          TextField("Text", text: $text)
          TextField("URL", text: $url).focused($urlFocused)
        }
        HStack {
          Spacer()
          Button("Cancel") { dismiss() }.keyboardShortcut(.cancelAction)
          Button("Save") { save(text, url) }
            .keyboardShortcut(.defaultAction)
            .disabled(ComposerLink.normalizedURL(url) == nil)
        }
      }
      .padding(20)
      .frame(minWidth: 360)
      .onAppear { urlFocused = true }
    }
  }
#endif

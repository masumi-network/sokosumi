import CoreAPI
import CryptoKit
import Foundation
import ImageIO
import SokosumiAuth
import SokosumiChat
import SokosumiWorkspace
import SwiftUI
import Synchronization

/// Fixture data and diagnostics; rendering reuses production components in the copied workspace.
@MainActor enum RichRowFixture {
  static let omittedComponent = ProcessInfo.processInfo.environment["REPRO_OMIT"] ?? "none"
  static let diagnostics = ProcessInfo.processInfo.environment["REPRO_DIAGNOSTICS"] == "1"
  static let auth = AuthState(store: InMemoryTokenStore())
  static let workspace = WorkspaceState()
  static var renderEvaluations: [Int: Int] = [:]
  static var bodyEvaluations: [String: Int] = [:]

  static func message(at row: Int) -> Components.Schemas.ChatRoomMessage {
    if diagnostics {
      renderEvaluations[row, default: 0] += 1
    }
    return messages[row]
  }

  static func recordBody(_ id: String) {
    if diagnostics {
      bodyEvaluations[id, default: 0] += 1
    }
  }

  static let messages: [Components.Schemas.ChatRoomMessage] = (0 ..< 600).map { index in
    let names = ["Patrick Tobler", "Francis Luz", "Andreas", "Phil"]
    let person = index % names.count
    let base = "Message \(index). "
    let content: String = switch index % 9 {
    case 1:
      base + "Should we try to make a ChatGPT Plugin for Sokosumi? https://chatgpt.com/plugins\nThere aren't many right now and it could give us some visibility."
    case 2:
      base + "Here is the screen:\n\n![Screenshot.png](https://rich-row-fixture.invalid/shot-\(index).png)"
    case 4:
      base + "\n\n```swift\n" + String(repeating: "let result = values.map { $0 * 2 }\n", count: 6) + "```"
    case 6:
      base + "**Improve channel member management discoverability** is done. The draft pull request adds Add members to the Members panel, with desktop and mobile checks completed. It remains a draft; no production deployment was made."
    case 7:
      base + "I had this one before but I can move the tasks there."
    default:
      base + String(repeating: "We should definitely do it for all, but we are currently not there yet with CLI / Skills. ", count: 1 + index % 3)
    }
    var message = chatRoomMessage(from: .init(
      clientTurnId: "fixture-\(index)", roomId: "fixture", content: content,
      createdAt: Date(timeIntervalSince1970: 1_790_000_000 + Double(index) * 1800),
      sender: .init(id: "u\(person)", name: names[person], email: "u\(person)@example.com", presence: .online)
    ))
    message.id = "fixture-\(index)"
    if index % 9 == 7 {
      message.quote = .init(messageId: "fixture-\(max(0, index - 5))", authorName: names[0],
                            snippet: "@Francis Luz is there a reason why you didn't use the Sokosumi Development project?",
                            attachment: .init(fileName: "Screenshot.png", url: "https://rich-row-fixture.invalid/quote-\(index).png", mediaKind: .image))
    }
    if [3, 6].contains(index % 9) {
      message.reactions = [.init(emoji: "👍", count: 2, reactedByCurrentUser: false, reactors: [.init(id: "other", name: "Other")])]
    }
    return message
  }

  static var fingerprint: String {
    let encoder = JSONEncoder()
    encoder.outputFormatting = .sortedKeys
    encoder.dateEncodingStrategy = .secondsSince1970
    do {
      return try SHA256.hash(data: encoder.encode(messages)).map { String(format: "%02x", $0) }.joined()
    } catch { fatalError("Cannot fingerprint fixture: \(error)") }
  }

  static func installMedia() {
    // Generate the same local image before any measured publication; no live service is required.
    _ = FixtureMedia.imageData
    URLProtocol.registerClass(FixtureMedia.self)
  }
}

/// The fixture's displayed content, with the same production children and no unused row state/chrome.
struct FixtureContentRow: View {
  let message: Components.Schemas.ChatRoomMessage
  let document: MessageMarkdown?

  var body: some View {
    HStack(alignment: .top, spacing: 14) {
      ParticipantProfileButton(sender: message.sender) {
        ParticipantAvatar(imageURL: messageSenderImage(message.sender), name: messageSenderName(message.sender), size: MessageRowView.avatarDiameter)
      }
      VStack(alignment: .leading, spacing: 6) {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
          ParticipantProfileButton(sender: message.sender) {
            Text(messageSenderName(message.sender)).fontWeight(.semibold).foregroundStyle(.primary).lineLimit(1)
          }
          DeliveryFeedback(pendingSince: nil, sentAt: nil, timestamp: message.createdAt)
        }
        if let quote = message.quote {
          MessageQuoteView(quote: quote).id(quote.messageId + quote.snippet)
        }
        MessageMarkdownView(source: message.content, preparedDocument: document)
        if !message.reactions.isEmpty {
          MessageReactionsView(reactions: message.reactions)
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .padding(.vertical, 4)
    .padding(.horizontal, 12)
    .padding(.top, 8)
  }
}

/// Production image loaders receive deterministic PNG data through their normal URLSession path.
private final nonisolated class FixtureMedia: URLProtocol, @unchecked Sendable {
  private let pending = Mutex<Task<Void, Never>?>(nil)

  override static func canInit(with request: URLRequest) -> Bool {
    request.url?.host == "rich-row-fixture.invalid"
  }

  override static func canonicalRequest(for request: URLRequest) -> URLRequest {
    request
  }

  override func startLoading() {
    let task = Task { @Sendable [self] in
      do { try await Task.sleep(for: .milliseconds(50)) } catch { return }
      guard let url = request.url,
            let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil,
                                           headerFields: ["Content-Type": "image/png"]) else { return }
      client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
      client?.urlProtocol(self, didLoad: Self.imageData)
      client?.urlProtocolDidFinishLoading(self)
    }
    pending.withLock { $0 = task }
  }

  override func stopLoading() {
    pending.withLock { $0?.cancel()
      $0 = nil
    }
  }

  static let imageData: Data = {
    guard let context = CGContext(data: nil, width: 2400, height: 1600, bitsPerComponent: 8, bytesPerRow: 0,
                                  space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else {
      fatalError("Cannot create fixture image")
    }
    for row in 0 ..< 1600 {
      context.setFillColor(CGColor(red: CGFloat(row % 255) / 255, green: 0.85, blue: 0.15, alpha: 1))
      context.fill(CGRect(x: 0, y: row, width: 2400, height: 1))
    }
    let data = NSMutableData()
    guard let image = context.makeImage(), let destination = CGImageDestinationCreateWithData(data, "public.png" as CFString, 1, nil) else {
      fatalError("Cannot encode fixture image")
    }
    CGImageDestinationAddImage(destination, image, nil)
    guard CGImageDestinationFinalize(destination) else { fatalError("Cannot finish fixture image") }
    return data as Data
  }()
}

/// Used only by the copied Markdown view; the enabled branch keeps production selection.
extension View {
  @ViewBuilder func reproductionBodySelection(nested: Bool = false) -> some View {
    if RichRowFixture.omittedComponent == "all-selection" || (!nested && RichRowFixture.omittedComponent == "body-selection") {
      textSelection(.disabled)
    } else {
      textSelection(.enabled)
    }
  }
}

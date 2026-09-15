#if os(macOS)
  import Foundation
  import ImageIO
  import Synchronization

  /// Deterministic delayed media for transcript image views; never reaches the network.
  final nonisolated class ScrollMediaProtocol: URLProtocol, @unchecked Sendable {
    private static let completions = Mutex(0)
    private let pending = Mutex<Task<Void, Never>?>(nil)
    static var completedRequests: Int {
      completions.withLock { $0 }
    }

    override static func canInit(with request: URLRequest) -> Bool {
      request.url?.host == "scroll-fixture.invalid"
    }

    override static func canonicalRequest(for request: URLRequest) -> URLRequest {
      request
    }

    override func startLoading() {
      guard let url = request.url else { return }
      let query = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
      let svg = query.contains { $0.name == "format" && $0.value == "svg" }
      let shape = query.first { $0.name == "shape" }?.value
      let failure = query.contains { $0.name == "failure" }
      let delay = query.first { $0.name == "delay" }?.value.flatMap(Double.init) ?? 0.05
      let work = Task { @Sendable [self] in
        do { try await Task.sleep(for: .seconds(delay)) } catch { return }
        defer { pending.withLock { $0 = nil } }
        guard let url = request.url,
              let response = HTTPURLResponse(url: url, statusCode: failure ? 500 : 200, httpVersion: nil,
                                             headerFields: ["Content-Type": svg ? "image/svg+xml" : "image/png"]) else { return }
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: svg ? Self.svgData(shape: shape) : Self.imageData)
        client?.urlProtocolDidFinishLoading(self)
        Self.completions.withLock { $0 += 1 }
      }
      pending.withLock { $0 = work }
    }

    private static func svgData(shape: String?) -> Data {
      let width = shape == "portrait" ? 80 : 240
      let height = shape == "wide" ? 30 : 160
      return Data("""
      <svg xmlns="http://www.w3.org/2000/svg" width="\(width)" height="\(height)">
        <rect width="\(width)" height="\(height)" fill="rgb(76,217,38)"/>
      </svg>
      """.utf8)
    }

    override func stopLoading() {
      pending.withLock { $0?.cancel()
        $0 = nil
      }
    }

    private static let imageData: Data = {
      guard let context = CGContext(data: nil, width: 2400, height: 1600, bitsPerComponent: 8,
                                    bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(),
                                    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return Data() }
      for row in 0 ..< 1600 {
        context.setFillColor(CGColor(red: CGFloat(row % 255) / 255, green: 0.85, blue: 0.15, alpha: 1))
        context.fill(CGRect(x: 0, y: row, width: 2400, height: 1))
      }
      let data = NSMutableData()
      guard let image = context.makeImage(),
            let destination = CGImageDestinationCreateWithData(data, "public.png" as CFString, 1, nil) else { return Data() }
      CGImageDestinationAddImage(destination, image, nil)
      guard CGImageDestinationFinalize(destination) else { return Data() }
      return data as Data
    }()
  }
#endif

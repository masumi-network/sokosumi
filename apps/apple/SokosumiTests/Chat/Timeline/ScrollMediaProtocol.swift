#if os(macOS)
  import Foundation
  import ImageIO
  import Synchronization

  /// Deterministic delayed media for the real AsyncImage views; never reaches the network.
  final class ScrollMediaProtocol: URLProtocol, @unchecked Sendable {
    private static let completions = Mutex(0)
    private let pending = Mutex<DispatchWorkItem?>(nil)
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
      let work = DispatchWorkItem { [self] in
        guard let url = request.url,
              let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil,
                                             headerFields: ["Content-Type": "image/png"]) else { return }
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Self.imageData)
        client?.urlProtocolDidFinishLoading(self)
        Self.completions.withLock { $0 += 1 }
      }
      pending.withLock { $0 = work }
      DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + 0.05, execute: work)
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
        context.setFillColor(CGColor(red: CGFloat(row % 255) / 255, green: 0.4, blue: 0.7, alpha: 1))
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

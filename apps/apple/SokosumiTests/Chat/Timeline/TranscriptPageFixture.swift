#if os(macOS)
  import AppKit
  import CoreAPI
  import Foundation
  import Synchronization
  import Testing

  /// Core's message pages for a hosted room or Thread: answers the first page at once and holds each later one in
  /// `pendingResponse` until the test releases it. Only message pages are counted and scripted; anything else is a 404.
  final nonisolated class TranscriptPageProtocol: URLProtocol, @unchecked Sendable {
    static let host = "page-fixture.invalid"
    static let responses = Mutex<[Data]>([])
    static let requests = Mutex(0)
    static let pendingResponse = Mutex<(@Sendable () -> Void)?>(nil)
    private let cancelled = Mutex(false)

    /// Scripts `pages` in request order and forgets what an earlier test left.
    static func serve(_ pages: [Data]) {
      responses.withLock { $0 = pages }
      requests.withLock { $0 = 0 }
      pendingResponse.withLock { $0 = nil }
    }

    /// Answers the held page, off the main thread as a network reply would arrive.
    static func releaseHeldPage() throws {
      let response = try #require(pendingResponse.withLock { response in
        defer { response = nil }
        return response
      })
      DispatchQueue.global().async(execute: response)
    }

    static func session() -> URLSession {
      let configuration = URLSessionConfiguration.ephemeral
      configuration.protocolClasses = [Self.self]
      return URLSession(configuration: configuration)
    }

    /// A `{data, meta}` messages page in Core's shape.
    static func page(_ messages: [Components.Schemas.ChatRoomMessage], cursor: String?) throws -> Data {
      let encoder = JSONEncoder()
      let formatter = DateFormatter()
      formatter.locale = Locale(identifier: "en_US_POSIX")
      formatter.timeZone = TimeZone(secondsFromGMT: 0)
      formatter.dateFormat = "yyyy-MM-dd'T'HH:mm:ss.SSSXXXXX"
      encoder.dateEncodingStrategy = .formatted(formatter)
      return try JSONSerialization.data(withJSONObject: [
        "data": JSONSerialization.jsonObject(with: encoder.encode(messages)),
        "meta": ["timestamp": "2026-09-14T00:00:00.000Z", "requestId": "fixture",
                 "pagination": ["cursor": NSNull(), "limit": 30, "total": messages.count, "nextCursor": cursor as Any? ?? NSNull()]]
      ])
    }

    override static func canInit(with request: URLRequest) -> Bool {
      request.url?.host == host
    }

    override static func canonicalRequest(for request: URLRequest) -> URLRequest {
      request
    }

    override func startLoading() {
      guard request.url?.path.hasSuffix("/messages") == true else {
        if let url = request.url, let response = HTTPURLResponse(url: url, statusCode: 404, httpVersion: nil, headerFields: nil) {
          client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
          client?.urlProtocolDidFinishLoading(self)
        }
        return
      }
      let number = Self.requests.withLock { $0 += 1
        return $0
      }
      let data = Self.responses.withLock { $0.isEmpty ? Data() : $0.removeFirst() }
      guard let url = request.url, let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil,
                                                                  headerFields: ["Content-Type": "application/json"]) else { return }
      let complete: @Sendable () -> Void = { [self] in
        guard !cancelled.withLock({ $0 }) else { return }
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
      }
      if number == 1 {
        complete()
      } else {
        Self.pendingResponse.withLock { $0 = complete }
      }
    }

    override func stopLoading() {
      cancelled.withLock { $0 = true }
    }
  }

  /// Whether rows already on screen stayed put while a page was inserted above them.
  enum TranscriptReadingPosition {
    /// Sub-pixel / antialias drift is not a product failure. A jump of about a message row is.
    static let band = 16

    @MainActor static func snapshot(_ host: NSView) throws -> CGImage {
      let image = try #require(host.bitmapImageRepForCachingDisplay(in: host.bounds))
      host.cacheDisplay(in: host.bounds, to: image)
      return try #require(image.cgImage)
    }

    /// Compares the lower visible rows of two renders and expects them within `band` backing pixels of each other.
    @MainActor static func expectStable(_ host: NSView, before: CGImage, sourceLocation: SourceLocation = #_sourceLocation) async throws {
      let after = try snapshot(host)
      // Lazy stacks estimate their total height. Compare visible pixels instead of that estimate.
      let shift = try await Task.detached { try renderedShift(before: before, after: after) }.value
      if abs(shift) > band {
        Attachment.record(before, named: "pagination-before")
        Attachment.record(after, named: "pagination-after")
      }
      #expect(abs(shift) <= band, "Prepending rows moved visible text by \(shift) backing pixels (band is \(band) px).",
              sourceLocation: sourceLocation)
    }

    private nonisolated static func renderedShift(before: CGImage, after: CGImage) throws -> Int {
      let firstData = try #require(before.dataProvider?.data)
      let secondData = try #require(after.dataProvider?.data)
      defer { withExtendedLifetime((firstData, secondData)) {} }
      let first = try #require(CFDataGetBytePtr(firstData))
      let second = try #require(CFDataGetBytePtr(secondData))
      try #require(before.width == after.width && before.height == after.height)
      try #require(before.bitsPerPixel == after.bitsPerPixel && before.bitsPerPixel == 32)
      /// Compare lower visible rows: at the top, the upper half includes the changing page boundary.
      func difference(_ shift: Int) -> Int {
        var total = 0
        for row in stride(from: before.height / 2, to: before.height * 2 / 3, by: 3) {
          for column in stride(from: before.width / 12, to: before.width / 3, by: 4) {
            let firstOffset = row * before.bytesPerRow + column * 4
            let secondOffset = (row + shift) * after.bytesPerRow + column * 4
            for component in 0 ..< 4 {
              total += abs(Int(first[firstOffset + component]) - Int(second[secondOffset + component]))
            }
          }
        }
        return total
      }
      let shift = try #require((-100 ... 100).min { difference($0) < difference($1) })
      try #require(difference(shift) < difference(shift + 20), "The fixture must render identifiable text.")
      return shift
    }
  }
#endif

import Foundation
import ImageIO
@testable import SokosumiChat
import Testing

@MainActor
struct ImageThumbnailTests {
  private func imageData() throws -> Data {
    let context = try #require(CGContext(
      data: nil, width: 80, height: 40, bitsPerComponent: 8, bytesPerRow: 0,
      space: CGColorSpaceCreateDeviceRGB(),
      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    ))
    let image = try #require(context.makeImage())
    let data = NSMutableData()
    let destination = try #require(CGImageDestinationCreateWithData(data, "public.png" as CFString, 1, nil))
    CGImageDestinationAddImage(destination, image, nil)
    #expect(CGImageDestinationFinalize(destination))
    return data as Data
  }

  @Test func thumbnailFromMainActorPreservesAspectRatioAndPixelLimit() async throws {
    let image = try #require(await decodeImageThumbnail(data: imageData(), maxPixel: 20))
    #expect(image.width == 20)
    #expect(image.height == 10)
  }

  @Test func invalidImageReturnsNil() async {
    #expect(await decodeImageThumbnail(data: Data("invalid".utf8), maxPixel: 20) == nil)
  }

  @Test func cancelledDecodeReturnsNil() async throws {
    let data = try imageData()
    let task = Task {
      withUnsafeCurrentTask { $0?.cancel() }
      return await decodeImageThumbnail(data: data, maxPixel: 20)
    }
    #expect(await task.value == nil)
  }
}

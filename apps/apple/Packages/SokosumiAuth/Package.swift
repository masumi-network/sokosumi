// swift-tools-version: 6.2

import PackageDescription

let package = Package(
  name: "SokosumiAuth",
  platforms: [
    .macOS(.v26),
    .iOS(.v17)
  ],
  products: [
    .library(name: "SokosumiAuth", targets: ["SokosumiAuth"])
  ],
  dependencies: [
    .package(url: "https://github.com/apple/swift-openapi-runtime", from: "1.8.2"),
    // Direct `import HTTPTypes` needs a declared dependency: SwiftPM links
    // the transitive closure, but Xcode links each product against its
    // declared deps only (SOK-973: `xcodebuild test` proved it).
    .package(url: "https://github.com/apple/swift-http-types", from: "1.8.0")
  ],
  targets: [
    .target(
      name: "SokosumiAuth",
      dependencies: [
        .product(name: "OpenAPIRuntime", package: "swift-openapi-runtime"),
        .product(name: "HTTPTypes", package: "swift-http-types")
      ]
    ),
    .testTarget(
      name: "SokosumiAuthTests",
      dependencies: [
        "SokosumiAuth",
        .product(name: "OpenAPIRuntime", package: "swift-openapi-runtime"),
        .product(name: "HTTPTypes", package: "swift-http-types")
      ]
    )
  ]
)

// swift-tools-version: 6.2

import PackageDescription

let package = Package(
  name: "SokosumiChat",
  platforms: [
    .macOS(.v14),
    .iOS(.v17)
  ],
  products: [
    .library(name: "SokosumiChat", targets: ["SokosumiChat"])
  ],
  dependencies: [
    .package(path: "../CoreAPI"),
    .package(url: "https://github.com/apple/swift-openapi-runtime", from: "1.8.2"),
    // Direct `import HTTPTypes` needs a declared dependency: SwiftPM links
    // the transitive closure, but Xcode links each product against its
    // declared deps only (SOK-973: `xcodebuild test` proved it).
    .package(url: "https://github.com/apple/swift-http-types", from: "1.8.0")
  ],
  targets: [
    .target(
      name: "SokosumiChat",
      dependencies: [
        .product(name: "CoreAPI", package: "CoreAPI"),
        .product(name: "OpenAPIRuntime", package: "swift-openapi-runtime"),
        .product(name: "HTTPTypes", package: "swift-http-types")
      ]
    ),
    .testTarget(
      name: "SokosumiChatTests",
      dependencies: [
        "SokosumiChat",
        .product(name: "CoreAPI", package: "CoreAPI"),
        .product(name: "OpenAPIRuntime", package: "swift-openapi-runtime"),
        .product(name: "HTTPTypes", package: "swift-http-types")
      ]
    )
  ]
)

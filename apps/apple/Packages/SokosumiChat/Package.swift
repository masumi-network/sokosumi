// swift-tools-version: 6.2

import PackageDescription

let package = Package(
  name: "SokosumiChat",
  platforms: [
    .macOS(.v14),
    .iOS(.v17),
  ],
  products: [
    .library(name: "SokosumiChat", targets: ["SokosumiChat"]),
  ],
  dependencies: [
    .package(path: "../CoreAPI"),
    .package(url: "https://github.com/apple/swift-openapi-runtime", from: "1.8.2"),
  ],
  targets: [
    .target(
      name: "SokosumiChat",
      dependencies: [
        .product(name: "CoreAPI", package: "CoreAPI"),
        .product(name: "OpenAPIRuntime", package: "swift-openapi-runtime"),
      ]
    ),
    .testTarget(
      name: "SokosumiChatTests",
      dependencies: [
        "SokosumiChat",
        .product(name: "CoreAPI", package: "CoreAPI"),
        .product(name: "OpenAPIRuntime", package: "swift-openapi-runtime"),
      ]
    ),
  ]
)

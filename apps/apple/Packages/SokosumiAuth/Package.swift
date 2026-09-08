// swift-tools-version: 6.2

import PackageDescription

let package = Package(
  name: "SokosumiAuth",
  platforms: [
    .macOS(.v14),
    .iOS(.v17),
  ],
  products: [
    .library(name: "SokosumiAuth", targets: ["SokosumiAuth"]),
  ],
  dependencies: [
    .package(url: "https://github.com/apple/swift-openapi-runtime", from: "1.8.2"),
  ],
  targets: [
    .target(
      name: "SokosumiAuth",
      dependencies: [
        .product(name: "OpenAPIRuntime", package: "swift-openapi-runtime"),
      ]
    ),
    .testTarget(
      name: "SokosumiAuthTests",
      dependencies: [
        "SokosumiAuth",
        .product(name: "OpenAPIRuntime", package: "swift-openapi-runtime"),
      ]
    ),
  ]
)

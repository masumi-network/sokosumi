// swift-tools-version: 6.2

import PackageDescription

let package = Package(
  name: "SokosumiRealtime",
  platforms: [
    .macOS(.v26),
    .iOS(.v26)
  ],
  products: [
    .library(name: "SokosumiRealtime", targets: ["SokosumiRealtime"])
  ],
  dependencies: [
    .package(path: "../CoreAPI"),
    .package(path: "../SokosumiChat"),
    .package(url: "https://github.com/ably/ably-cocoa", from: "1.4.0")
  ],
  targets: [
    .target(
      name: "SokosumiRealtime",
      dependencies: [
        .product(name: "CoreAPI", package: "CoreAPI"),
        .product(name: "SokosumiChat", package: "SokosumiChat"),
        .product(name: "Ably", package: "ably-cocoa")
      ]
    ),
    .testTarget(
      name: "SokosumiRealtimeTests",
      dependencies: [
        "SokosumiRealtime",
        .product(name: "CoreAPI", package: "CoreAPI"),
        .product(name: "SokosumiChat", package: "SokosumiChat")
      ]
    )
  ]
)

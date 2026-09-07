// swift-tools-version: 6.2

import PackageDescription

let package = Package(
  name: "CoreAPI",
  platforms: [
    .macOS(.v14),
    .iOS(.v17),
  ],
  products: [
    .library(name: "CoreAPI", targets: ["CoreAPI"]),
  ],
  dependencies: [
    .package(url: "https://github.com/apple/swift-openapi-generator", from: "1.10.3"),
    .package(url: "https://github.com/apple/swift-openapi-runtime", from: "1.8.2"),
    .package(url: "https://github.com/apple/swift-openapi-urlsession", from: "1.1.0"),
  ],
  targets: [
    .target(
      name: "CoreAPI",
      dependencies: [
        .product(name: "OpenAPIRuntime", package: "swift-openapi-runtime"),
        .product(name: "OpenAPIURLSession", package: "swift-openapi-urlsession"),
      ],
      plugins: [
        .plugin(name: "OpenAPIGenerator", package: "swift-openapi-generator"),
      ]
    ),
    .testTarget(
      name: "CoreAPITests",
      dependencies: [
        "CoreAPI",
        .product(name: "OpenAPIRuntime", package: "swift-openapi-runtime"),
      ]
    ),
  ]
)

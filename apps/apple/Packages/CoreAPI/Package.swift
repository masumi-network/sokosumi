// swift-tools-version: 6.2

import PackageDescription

let package = Package(
  name: "CoreAPI",
  platforms: [
    .macOS(.v26),
    .iOS(.v26)
  ],
  products: [
    .library(name: "CoreAPI", targets: ["CoreAPI"])
  ],
  dependencies: [
    .package(url: "https://github.com/apple/swift-openapi-generator", from: "1.10.3"),
    .package(url: "https://github.com/apple/swift-openapi-runtime", from: "1.8.2"),
    .package(url: "https://github.com/apple/swift-openapi-urlsession", from: "1.1.0"),
    // Generated sources `import HTTPTypes` directly: needs a declared
    // dependency since Xcode links each product against declared deps only.
    .package(url: "https://github.com/apple/swift-http-types", from: "1.8.0")
  ],
  targets: [
    .target(
      name: "CoreAPI",
      dependencies: [
        .product(name: "OpenAPIRuntime", package: "swift-openapi-runtime"),
        .product(name: "OpenAPIURLSession", package: "swift-openapi-urlsession"),
        .product(name: "HTTPTypes", package: "swift-http-types")
      ],
      plugins: [
        .plugin(name: "OpenAPIGenerator", package: "swift-openapi-generator")
      ]
    ),
    .testTarget(
      name: "CoreAPITests",
      dependencies: [
        "CoreAPI",
        .product(name: "OpenAPIRuntime", package: "swift-openapi-runtime"),
        .product(name: "HTTPTypes", package: "swift-http-types")
      ]
    )
  ]
)

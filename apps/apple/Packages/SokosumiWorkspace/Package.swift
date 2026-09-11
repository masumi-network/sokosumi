// swift-tools-version: 6.2
import PackageDescription

let package = Package(
  name: "SokosumiWorkspace",
  platforms: [.macOS(.v26), .iOS(.v17)],
  products: [.library(name: "SokosumiWorkspace", targets: ["SokosumiWorkspace"])],
  dependencies: [
    .package(path: "../CoreAPI"),
    .package(path: "../SokosumiAuth"),
    .package(path: "../SokosumiChat"),
    .package(path: "../SokosumiRealtime"),
    .package(url: "https://github.com/apple/swift-openapi-runtime", from: "1.8.2"),
    .package(url: "https://github.com/apple/swift-http-types", from: "1.8.0")
  ],
  targets: [
    .target(name: "SokosumiWorkspace", dependencies: ["CoreAPI", "SokosumiAuth", "SokosumiChat", "SokosumiRealtime", .product(name: "OpenAPIRuntime", package: "swift-openapi-runtime")]),
    .testTarget(name: "SokosumiWorkspaceTests", dependencies: [
      "SokosumiWorkspace", "CoreAPI", "SokosumiAuth", "SokosumiChat", "SokosumiRealtime",
      .product(name: "OpenAPIRuntime", package: "swift-openapi-runtime"),
      .product(name: "HTTPTypes", package: "swift-http-types")
    ], swiftSettings: [.defaultIsolation(MainActor.self)])
  ]
)

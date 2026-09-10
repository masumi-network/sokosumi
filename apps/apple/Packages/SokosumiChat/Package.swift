// swift-tools-version: 6.2

import PackageDescription

let package = Package(
  name: "SokosumiChat",
  platforms: [
    .macOS(.v26),
    .iOS(.v17)
  ],
  products: [
    .library(name: "SokosumiChat", targets: ["SokosumiChat"])
  ],
  dependencies: [
    .package(path: "../CoreAPI"),
    .package(url: "https://github.com/scinfu/SwiftSoup.git", exact: "2.13.9"),
    .package(url: "https://github.com/swiftlang/swift-markdown.git", exact: "0.8.0"),
    .package(url: "https://github.com/tree-sitter/swift-tree-sitter", exact: "0.10.0"),
    .package(url: "https://github.com/simonbs/TreeSitterLanguages", exact: "0.1.10"),
    .package(url: "https://github.com/tree-sitter-grammars/tree-sitter-kotlin", exact: "1.1.0"),
    .package(url: "https://github.com/tree-sitter-grammars/tree-sitter-objc", exact: "3.0.2"),
    .package(url: "https://github.com/tree-sitter-grammars/tree-sitter-xml", exact: "0.7.0"),
    .package(url: "https://github.com/tree-sitter-grammars/tree-sitter-make", exact: "1.1.1"),
    .package(url: "https://github.com/tree-sitter-grammars/tree-sitter-diff", exact: "0.2.0"),
    .package(url: "https://github.com/justinmk/tree-sitter-ini", exact: "1.4.0"),
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
      ],
      resources: [.copy("Resources/Emoji")]
    ),
    .testTarget(
      name: "SokosumiChatTests",
      dependencies: [
        "SokosumiChat",
        .product(name: "SwiftSoup", package: "SwiftSoup"),
        .product(name: "Markdown", package: "swift-markdown"),
        .product(name: "SwiftTreeSitter", package: "swift-tree-sitter"),
        .product(name: "TreeSitterSwift", package: "TreeSitterLanguages"),
        .product(name: "TreeSitterSwiftQueries", package: "TreeSitterLanguages"),
        .product(name: "TreeSitterJSON", package: "TreeSitterLanguages"),
        .product(name: "TreeSitterJSONQueries", package: "TreeSitterLanguages"),
        .product(name: "TreeSitterKotlin", package: "tree-sitter-kotlin"),
        .product(name: "TreeSitterObjc", package: "tree-sitter-objc"),
        .product(name: "TreeSitterXML", package: "tree-sitter-xml"),
        .product(name: "TreeSitterMake", package: "tree-sitter-make"),
        .product(name: "TreeSitterDiff", package: "tree-sitter-diff"),
        .product(name: "TreeSitterIni", package: "tree-sitter-ini"),
        .product(name: "CoreAPI", package: "CoreAPI"),
        .product(name: "OpenAPIRuntime", package: "swift-openapi-runtime"),
        .product(name: "HTTPTypes", package: "swift-http-types")
      ]
    )
  ]
)

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
    .package(url: "https://github.com/mdovale/tree-sitter-less", revision: "02988c765d30adb0476657b5d220e8dfde1c07d3"),
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
      name: "TreeSitterGraphQL",
      path: "Vendor/TreeSitterGraphQL",
      sources: ["src/parser.c"],
      publicHeadersPath: "include",
      cSettings: [.headerSearchPath("src")]
    ),
    .target(
      name: "SokosumiChat",
      dependencies: [
        .product(name: "TreeSitterBash", package: "TreeSitterLanguages"),
        .product(name: "TreeSitterBashQueries", package: "TreeSitterLanguages"),
        .product(name: "TreeSitterC", package: "TreeSitterLanguages"),
        .product(name: "TreeSitterCQueries", package: "TreeSitterLanguages"),
        .product(name: "TreeSitterCPP", package: "TreeSitterLanguages"),
        .product(name: "TreeSitterCPPQueries", package: "TreeSitterLanguages"),
        .product(name: "TreeSitterCSharp", package: "TreeSitterLanguages"),
        .product(name: "TreeSitterCSharpQueries", package: "TreeSitterLanguages"),
        .product(name: "TreeSitterCSS", package: "TreeSitterLanguages"),
        .product(name: "TreeSitterCSSQueries", package: "TreeSitterLanguages"),
        .product(name: "TreeSitterGo", package: "TreeSitterLanguages"),
        .product(name: "TreeSitterGoQueries", package: "TreeSitterLanguages"),
        .product(name: "TreeSitterJava", package: "TreeSitterLanguages"),
        .product(name: "TreeSitterJavaQueries", package: "TreeSitterLanguages"),
        .product(name: "TreeSitterJavaScript", package: "TreeSitterLanguages"),
        .product(name: "TreeSitterJavaScriptQueries", package: "TreeSitterLanguages"),
        .product(name: "TreeSitterLua", package: "TreeSitterLanguages"),
        .product(name: "TreeSitterLuaQueries", package: "TreeSitterLanguages"),
        .product(name: "TreeSitterMarkdown", package: "TreeSitterLanguages"),
        .product(name: "TreeSitterMarkdownQueries", package: "TreeSitterLanguages"),
        .product(name: "TreeSitterPerl", package: "TreeSitterLanguages"),
        .product(name: "TreeSitterPerlQueries", package: "TreeSitterLanguages"),
        .product(name: "TreeSitterPHP", package: "TreeSitterLanguages"),
        .product(name: "TreeSitterPHPQueries", package: "TreeSitterLanguages"),
        .product(name: "TreeSitterPython", package: "TreeSitterLanguages"),
        .product(name: "TreeSitterPythonQueries", package: "TreeSitterLanguages"),
        .product(name: "TreeSitterR", package: "TreeSitterLanguages"),
        .product(name: "TreeSitterRQueries", package: "TreeSitterLanguages"),
        .product(name: "TreeSitterRuby", package: "TreeSitterLanguages"),
        .product(name: "TreeSitterRubyQueries", package: "TreeSitterLanguages"),
        .product(name: "TreeSitterRust", package: "TreeSitterLanguages"),
        .product(name: "TreeSitterRustQueries", package: "TreeSitterLanguages"),
        .product(name: "TreeSitterSCSS", package: "TreeSitterLanguages"),
        .product(name: "TreeSitterSCSSQueries", package: "TreeSitterLanguages"),
        .product(name: "TreeSitterSQL", package: "TreeSitterLanguages"),
        .product(name: "TreeSitterSQLQueries", package: "TreeSitterLanguages"),
        .product(name: "TreeSitterTypeScript", package: "TreeSitterLanguages"),
        .product(name: "TreeSitterTypeScriptQueries", package: "TreeSitterLanguages"),
        .product(name: "TreeSitterYAML", package: "TreeSitterLanguages"),
        .product(name: "TreeSitterYAMLQueries", package: "TreeSitterLanguages"),
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
      ],
      resources: [.copy("Resources/Emoji"), .copy("Resources/GrammarDependencies"), .copy("Resources/HighlightQueries")]
    ),
    .testTarget(
      name: "SokosumiChatTests",
      dependencies: [
        "SokosumiChat",
        "TreeSitterGraphQL",
        .product(name: "TreeSitterLess", package: "tree-sitter-less"),
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

# Native rich message rendering

## Approach

`MessageMarkdown` uses swift-markdown's full document tree in UI-free `SokosumiChat`. That tree keeps empty fenced code blocks and table cells that Foundation presentation intents omit. Parse HTML fragments with SwiftSoup, then apply the web sanitization policy. Convert shortcodes and emoticons on Markdown text nodes with the bundled emojilib 2.4.0 and emoticon 4.1.0 JSON.

SwiftUI views render the resulting blocks in room and thread messages through `MessageMarkdownView`, `MessageCodeBlock`, and `ExpandableMessageBody`. Foundation attributed strings remain useful for inline styling. Preserve soft line breaks, task lists, underline, native text selection and the existing app URL policy. `NativeSyntaxHighlighter` uses SwiftTreeSitter; token ranges stay UI-free.

Do not bundle JavaScript engines or npm runtime libraries for rendering. TreeSitterLanguages resolves Runestone transitively; do not link Runestone, UIKit editor products, or a JavaScript runtime.

Live slice status and verification belong in [PARITY.md](../PARITY.md). Emoji resource versions, hashes and regeneration: [emoji-data.md](emoji-data.md). GraphQL (vendored) and LESS provenance: [graphql-less-grammars.md](graphql-less-grammars.md).

## Pins

Exact versions are in `Packages/SokosumiChat/Package.swift`. Current rendering dependencies:

| Package | Pin |
| --- | --- |
| SwiftSoup | 2.13.9 |
| swift-markdown | 0.8.0 |
| SwiftTreeSitter | 0.10.0 |
| TreeSitterLanguages | 0.1.10 |
| tree-sitter-kotlin | 1.1.0 |
| tree-sitter-objc | 3.0.2 |
| tree-sitter-xml | 0.7.0 |
| tree-sitter-make | 1.1.1 |
| tree-sitter-diff | 0.2.0 |
| tree-sitter-ini | 1.4.0 |

## Remainder

Slice 10 is Partial. Row 10b (remaining web language/dialect coverage, automatic detection, color/query refinements) is deferred and is not a blocker. New grammar or dependency updates still need approval.

Attachment chips/previews, Drive picker and participant profile UI live in `Chat/Rendering/`, `Chat/Composer/` and `Shared/`. They are not Markdown-pipeline work. Record verification in PARITY.md, not here.

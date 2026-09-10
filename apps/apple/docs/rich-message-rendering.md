# Slice 10: rich message rendering

## Rendering approach

Use Foundation `AttributedString(markdown:options:)` with full parsing in the UI-free SokosumiChat package. A local probe confirmed presentation intents for headings, paragraphs, nested list items, table rows/cells/alignment, and fenced-code language. SwiftUI views interpret these blocks in both room and thread messages. Preserve soft line breaks; handle task-list prefixes and sanitized inline underline markup explicitly. Keep ordinary links selectable and route them through the existing app URL policy.

Reuse MessageRow for shared room/thread presentation and the current streaming response content. Foundation does not perform syntax highlighting or emoji shortcode/emoticon conversion. There is no existing native renderer/highlighter in apps/apple.

## Approved native dependency direction

The user approved Foundation + SwiftUI with SwiftTreeSitter on 2026-09-10. The earlier highlight.js/JavaScriptCore proposal is withdrawn. Do not bundle JavaScript engines or npm runtime libraries for rendering.

Verify SwiftTreeSitter 0.10.0 (Swift bindings over the native C Tree-sitter runtime) and compiled language grammars in a separate dependency PR. Keep token ranges and styles UI-free; SwiftUI renders the results. The dependency PR validates Swift and JSON grammars as representative integrations. Additional grammar products and the complete language registry belong to slice 10; do not mark language parity complete based on these two probes. No syntax engine should execute message code.

Candidates examined: CodeEditLanguages provides a macOS binary container, so it does not meet iOS portability. TreeSitterLanguages 0.1.10 exposes individual C grammar and Foundation query-resource products; verify these products independently because its package also declares Runestone editor adapters, which the app must not link. Direct upstream grammar packages are an alternative where supported.

Emoji shortcodes/emoticons should be converted by Swift using data resources; a data source still needs selection and licensing review. Do not introduce node-emoji or emoticon as JavaScript runtime dependencies.

The dependency PR establishes and tests native parsing/highlighting dependencies before the slice 10 rendering PR. No rendering feature is complete until all behavior below is covered.

## Behavior to preserve

- Paragraphs and soft/hard breaks, six heading levels, nested ordered/unordered lists and task lists, aligned tables, quotes and thematic breaks.
- Bold, italic, underline, strike, inline code, safe links and bare-domain linkification. Do not reinterpret code contents as emoji or inline formatting.
- Highlight fenced code with web's common language registry and detection defaults; unsupported languages remain readable.
- Convert web emoji shortcodes/emoticons; raw emoji-only messages use jumbo sizing for 1, 2–3, 4–6 and 7–23 graphemes. At 24 or with non-emoji content, use normal size.
- Web message bodies clamp to 16 lines with Show more/Show less. Keep native selection/copy and stable streaming layout.
- Attachments and interactive mentions remain their later PARITY slices; preserve their visible text/links meanwhile.

## Evidence and verification

Web sources: `src/components/markdown.tsx`, `src/app/(app)/chat/components/room-message-row.tsx`, `room-mention-markdown.tsx`, `src/app/(app)/chat/utils/jumbo-emoji.ts`, `src/lib/utils/sanitizeMarkdown.ts` in apps/web. The installed rehype-highlight default registry is lowlight/common; web sets detect true. remark-emoji enables emoticons and transforms text nodes.

Required tests: block/inline fixtures, nested structures, tables, unsupported/malformed input, literal code, unsafe links, emoji sequences/limits, and streaming partial input. Build shared code for iOS17; run package and app suites plus lint/format. Visually verify room and thread rendering, light/dark themes, narrow widths, long-message expansion, selection, and incremental responses.

## Dependency verification

- Direct packages: SwiftTreeSitter 0.10.0 and TreeSitterLanguages 0.1.10, exact pins. Resolved native Tree-sitter runtime: 0.25.10.
- TreeSitterLanguages resolves Runestone 0.4.2 transitively. No Runestone product, UIKit editor, or JavaScript runtime is linked by the dependency tests.
- Representative dependency tests run Swift and JSON highlight queries; Swift verifies UTF-16 capture ranges across emoji text. Dependency products are test-only until the renderer integrates them in slice 10.
- macOS: Chat 176 tests passed, Xcode app suite passed, Swift lint/format passed. iOS17 compatibility build is recorded in PARITY.md when complete.

## Additional native grammars (approved 2026-09-10)

TreeSitterLanguages does not provide the six grammars below. Use their native
SwiftPM packages with the existing SwiftTreeSitter binding; no JavaScript engine
or web view is required. The separate dependency PR links them into tests first.
Rendering and language detection remain part of slice 10 after this PR merges.

| Language | Package | Exact version | License |
| --- | --- | --- | --- |
| Kotlin | tree-sitter-grammars/tree-sitter-kotlin | 1.1.0 | MIT |
| Objective-C | tree-sitter-grammars/tree-sitter-objc | 3.0.2 | MIT |
| XML | tree-sitter-grammars/tree-sitter-xml | 0.7.0 | MIT |
| Make | tree-sitter-grammars/tree-sitter-make | 1.1.1 | MIT |
| Diff | tree-sitter-grammars/tree-sitter-diff | 0.2.0 | MIT |
| INI | justinmk/tree-sitter-ini | 1.4.0 | Apache-2.0 |

The dependency tests parse Unicode fixtures and validate UTF-16 source ranges
for every grammar. They prove parser compatibility, not finished highlighting.
Query integration and the remaining web language registry gaps still need to be
covered by the renderer implementation.

# Slice 10: rich message rendering

## Rendering approach

Use swift-markdown's full document tree in the UI-free SokosumiChat package. It preserves empty fenced code blocks and table cells that Foundation's presentation intents omit. Parse raw HTML fragments with SwiftSoup, then apply the web sanitization policy explicitly. Convert shortcodes and emoticons on Markdown text nodes using the bundled emojilib 2.4.0 and emoticon 4.1.0 JSON resources.

SwiftUI views render the resulting blocks in room and thread messages, reusing MessageRow and streaming content. Foundation attributed strings remain useful for inline styling. Preserve soft line breaks, task lists, underline, native text selection and the existing app URL policy. SwiftTreeSitter provides native code highlighting.

The parser products are test-only in this prerequisite; renderer integration follows its merge.

## Approved native dependency direction

The user approved Foundation + SwiftUI with SwiftTreeSitter on 2026-09-10. The earlier highlight.js/JavaScriptCore proposal is withdrawn. Do not bundle JavaScript engines or npm runtime libraries for rendering.

Verify SwiftTreeSitter 0.10.0 (Swift bindings over the native C Tree-sitter runtime) and compiled language grammars in a separate dependency PR. Keep token ranges and styles UI-free; SwiftUI renders the results. The dependency PR validates Swift and JSON grammars as representative integrations. Additional grammar products and the complete language registry belong to slice 10; do not mark language parity complete based on these two probes. No syntax engine should execute message code.

Candidates examined: CodeEditLanguages provides a macOS binary container, so it does not meet iOS portability. TreeSitterLanguages 0.1.10 exposes individual C grammar and Foundation query-resource products; verify these products independently because its package also declares Runestone editor adapters, which the app must not link. Direct upstream grammar packages are an alternative where supported.

Emoji shortcodes/emoticons will be converted in Swift using the approved, licensed JSON described in [emoji data](emoji-data.md). Do not introduce node-emoji or emoticon as JavaScript runtime dependencies.

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

## Approved structural parser and emoji prerequisite

Approved by the user on 2026-09-10, in a separate PR from native rendering:

- SwiftSoup 2.13.9 (`SwiftSoup` product), MIT; Swift HTML parsing only.
- swift-markdown 0.8.0 (`Markdown` product), Apache 2.0 with Runtime Library Exception.
- Resolved swift-cmark 0.8.0, with its complete COPYING notices (BSD-style and MIT-derived components). SwiftPM records exact revisions in Package.resolved. The effective dependency graph adds these three packages; no new DocC package resolved on this Swift 6.2 toolchain.
- Data-only emojilib 2.4.0 and emoticon 4.1.0 resources, MIT notices included verbatim. [Emoji data](emoji-data.md) records versions, counts, hashes and regeneration steps. No npm package runs in the application.

Parser products are linked by the Chat test target only. Resources live in the
Chat bundle for later integration. Six dependency tests verify empty code blocks,
empty table headers/middle/trailing rows/cells, nested and unfinished Markdown,
HTML nesting repair, entity/URL attributes, explicit handling of unsafe HTML,
and emoji decoding. The HTML parser deliberately preserves scripts and unsafe
URLs: a parsing library is not the application's configured sanitizer. Apply the
web policy during renderer integration, with separate parity fixtures.

After this prerequisite merges, use the full Markdown tree to replace the lossy
Foundation block reconstruction, use SwiftSoup for HTML fragments, and convert
emoji text nodes in Swift. Keep all presentation native. Include the parser
libraries' full license notices in app distribution when linking their products.

Prerequisite verification: Chat 183, Auth 34, CoreAPI 1 and Realtime 27 tests
passed. Xcode app build/tests and the iOS 17 Chat test-target cross-build passed,
including both native parsers. Changed Swift files pass SwiftFormat/SwiftLint;
the data regeneration script passes Node syntax checking and reproduces hashes.
Logs: `/tmp/apple-parser-*.log`.
## Post-merge implementation audit

PR #4368 merged on 2026-09-10 with all Apple CI checks passing. The rendering branch starts at main `2ac96d30b`. No renderer is connected yet: raw Markdown in the user's screenshots is still the existing behavior.

The pinned TreeSitterLanguages product manifest has no dedicated grammar for web registry entries Arduino, diff, INI, Kotlin, Less, Makefile, Objective-C, PHP-template, Python REPL, shell sessions, VB.NET, WebAssembly, or XML. HTML, TOML, Bash, Python and C++ products must not be treated as exact substitutes without checking language behavior. Plaintext intentionally needs no grammar. Tree-sitter parsing also does not supply highlight.js language detection scores. Resolve these coverage and detection differences before claiming syntax parity; do not silently reduce the registry to Swift and JSON. Extra dependency additions still require their own approved PR.

Existing reuse candidates: MessageRow is the room/thread presentation seam; MessagePresentation only models grouping and metadata; the approved Foundation parser provides block/inline structure. No existing Apple Markdown or link-routing helper was found in that seam. Image attachment previews remain slice 15, while clickable Markdown links belong to slice 10.

## Parser implementation checkpoint

`MessageMarkdown` reconstructs Foundation presentation intents as a UI-free block tree, preserving inline styles, nested container identities, table column positions, literal code, and web-style soft line breaks. Executable/local link schemes are stripped while retaining their labels. Eight new parser tests pass; the full Chat suite passes 184 tests in 21 suites. The shared target also compiles for arm64 iOS 17 (`/tmp/apple-markdown-ios17.log`).

This is an implementation checkpoint, not a finished slice or a standalone feature PR. The parser is now wired into MessageRow through MessageMarkdownView for rooms, reply threads and streamed overlays. Remaining work includes native views, task markers, sanitized HTML/underline, linkification/routing, emoji data/conversion/jumbo sizing, highlighting coverage/detection, expansion, and visual/streaming verification. Foundation drops empty code blocks and cells without text runs; preserve their source structure where needed before claiming full table/code fidelity.

## Native view implementation checkpoint

`MessageMarkdownView` renders the block tree using SwiftUI text, lists, quotes, horizontally scrollable tables/code, and six semantic heading levels. Parsing runs away from the main actor; cancelled view tasks cannot publish stale parsed results. MessageRow reuses this view in room and thread contexts and keeps edited/deleted labels. An Xcode preview includes a representative report fixture.

Verification: Xcode build and app tests passed (`/tmp/apple-markdown-view-build.log`, `/tmp/apple-markdown-view-tests.log`); changed Swift files pass lint and format checks. This does not establish visual or full slice parity: verify native interaction/selection and the initial parse transition, then finish the remaining parser/highlighting/emoji/expansion requirements before opening the feature PR.

## Task lists and jumbo emoji checkpoint

Task-list parsing uses Foundation source positions to distinguish actual markers from escaped, code, bold and linked text. SwiftUI renders read-only checkbox symbols. Compared edge cases with the web's installed remark-parse/remark-gfm: empty markers remain literal, a tab is accepted, and exactly one separator is removed. Raw emoji-only messages use web's Extended_Pictographic/flag/keycap criteria, whitespace handling, 23-count maximum and four relative size tiers. Shortcodes still need their separate conversion; they do not trigger jumbo sizing.

Verification: 188 Chat tests in 22 suites, Xcode app tests, iOS17 shared build, and changed-file lint/format passed. A final parser-only test run also passed after the lint-mandated failable UTF-8 conversion. Logs: `/tmp/apple-task-emoji-suite.log`, `/tmp/apple-task-emoji-app.log`, `/tmp/apple-task-emoji-ios17.log`, `/tmp/apple-task-final-tests.log`. Native visual verification remains pending.

## Link routing checkpoint

MessageMarkdown now receives CoreSettings.webBaseURL from the app so relative Markdown destinations resolve against the configured production/local web origin. A regression test verifies relative routing, unchanged external links and rejection of local-file destinations. Ten parser tests and Xcode build passed (`/tmp/apple-relative-link-tests.log`, `/tmp/apple-relative-link-build.log`); changed files pass format lint.

A Foundation probe confirms that full parsing already recognizes scheme URLs, www links, emails and angle-bracket autolinks. The remaining bare-domain behavior is the explicit allowlist in `packages/utils/src/linkify-bare-domains.ts`, including filename exclusions and protection of code/existing links. Do not replace it with unrestricted data detection. Its transformation runs before Markdown interpretation on web, which matters for URL paths containing Markdown punctuation.

## Grammar approval outcome

The six additional grammars above were approved and merged in PR #4370 with all
Apple CI checks passing. The renderer branch now includes them from main.
Highlight query integration and remaining registry/detection gaps remain open.

## Highlight query audit (2026-09-10)

Executed the pinned upstream query files through SwiftTreeSitter 0.10.0 against
representative source fixtures (`/tmp/apple-grammar-queries.log`). Objective-C,
XML, Make, Diff, and INI queries compile and return named captures. XML's query
is under `queries/xml/highlights.scm` rather than `queries/highlights.scm`.

Kotlin 1.1.0 has no `queries` directory even though its Package.swift declares
that resource. Parser tests passing therefore do not prove Kotlin highlighting.
The renderer must supply a native Kotlin query against the pinned node schema;
it must not silently render Kotlin as plaintext. Objective-C declares
`; inherits: c`, requiring the existing C query to be composed before its own
query. Tree-sitter treats that directive as a comment; it does not load C for us.

These are renderer integration requirements, not reasons to add a JavaScript
runtime or claim reduced syntax coverage. Full language detection, aliases,
query resources in app bundles, and incomplete code/Unicode tests remain open.

## Native capture implementation checkpoint

`NativeSyntaxHighlighter` now returns portable UTF-16 capture ranges using the
approved SwiftTreeSitter binding. Swift and JSON reuse packaged queries; Kotlin
uses a query authored against its pinned node/token schema. Three tests cover
expected capture text, Unicode offsets, empty input and incomplete streaming
input. Targeted tests and iOS 17 shared-module compilation passed.

This is an implementation checkpoint within slice 10, not complete syntax
parity. The language enum currently covers Swift, JSON and Kotlin only; extend
it to the web registry, compose inherited queries, cover Kotlin's remaining
semantic captures, and connect background parsing plus native color styling
before opening the renderer PR. No code-block highlighting is visible yet.

## Code-block view checkpoint

`MessageCodeBlock` now applies native token colors to Swift/JSON/Kotlin fenced
blocks. Each block parses off the main actor with a task keyed by source and
fence info; stale results are rejected, and source text remains selectable and
unchanged. Kotlin `kt`/`kts` aliases and case-insensitive fence info are covered.
The app builds and four highlighter tests pass; Swift lint/format pass. Visual
colors/copy/streaming verification and remaining registry integration are still
required. Paragraph/heading wrapping also now requests its full vertical size
to avoid the report's earlier truncation; that visual follow-up remains pending.

## Expanded native query integration

The shared highlighter now integrates 20 more already-approved grammar products:
Bash, C, C++, C#, CSS, Go, Java, JavaScript, Lua, Markdown, Perl, PHP, Python, R,
Ruby, Rust, SCSS, SQL, TypeScript, and YAML. C++ composes C queries; TypeScript
composes JavaScript queries. The pinned SCSS query omits predicate prefixes and
variable captures, so the loader corrects its input and adds captures for the
parser's variable declaration/reference nodes. Dependency files remain unchanged.

Fixtures verify all 23 integrated languages return captures and valid UTF-16
ranges. A focused SCSS test verifies both declaration and reference text. Full
Chat tests (196), Xcode app build/tests, iOS 17 compilation, SwiftFormat, and strict SwiftLint passed. Logs: `/tmp/apple-expanded-{chat-tests,app,ios,format}.log` and `/tmp/apple-more-lint.log`.
Remaining work includes the other approved grammars, full aliases/detection,
semantic coverage, native visual verification, and the rendering gaps above.
This remains one incomplete rendering slice, with no feature PR yet.

## Remaining approved grammar resources

Objective-C, XML, Makefile, Diff, and INI now use the shared highlighter. Their
C-only packages provide resource bundles but no public Swift resource accessor.
Unmodified pinned queries and licenses are included in `Resources/HighlightQueries`
and loaded through `Bundle.module`; the resource README records provenance.
Objective-C composes the existing C query before its own. No new dependency
version or API contract was introduced. Xcode regenerated its lockfile with the
already-approved products now linked into the application.

Verification: 197 Chat tests, iOS 17 compilation, Xcode app build/tests, and
changed-file lint/format passed (`/tmp/apple-five-{suite,ios,app,lint,final-format}.log`).
The app-host test loads all five resources, covering app bundle lookup separately
from SwiftPM tests. Every copied query/license matches its pinned checkout exactly.
There are now 28 integrated grammars; remaining registry gaps, aliases/detection,
semantic fidelity, and other rendering requirements still block slice completion.

## Fence aliases and native dialects

Common aliases now resolve from the web's installed highlight.js 11.11.1 registry
(e.g. js/jsx, py, objc, c++, c#, yml, sh, md, rs, make and patch). HTML, TOML and
TSX use distinct products already included in the approved native package, rather
than routing those dialects to XML, INI or plain TypeScript. JavaScript/TSX compose
the package's separate JSX query so element names receive captures. JSONC uses
the JSON grammar, whose packaged query includes comment nodes.

Tests cover alias normalization, HTML void elements, TOML date values, JSX/TSX
elements, and JSON comments. Verification: 199 Chat tests, Xcode app build/tests,
iOS 17 compilation and lint/format passed (`/tmp/apple-alias-*.log`). This gives
31 native grammar choices; it does not complete the web registry. Embedded JSP,
Objective-C++, IPython and the remaining registry entries require further
syntax coverage work, as do automatic detection and full rendering verification.

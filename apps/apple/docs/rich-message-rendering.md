# Slice 10: rich message rendering

## Rendering approach

Use swift-markdown's full document tree in the UI-free SokosumiChat package. It preserves empty fenced code blocks and table cells that Foundation's presentation intents omit. Parse raw HTML fragments with SwiftSoup, then apply the web sanitization policy explicitly. Convert shortcodes and emoticons on Markdown text nodes using the bundled emojilib 2.4.0 and emoticon 4.1.0 JSON resources.

SwiftUI views render the resulting blocks in room and thread messages, reusing MessageRow and streaming content. Foundation attributed strings remain useful for inline styling. Preserve soft line breaks, task lists, underline, native text selection and the existing app URL policy. SwiftTreeSitter provides native code highlighting.

PR #4374 merged the parser prerequisite. The renderer branch now links Markdown and SwiftSoup in SokosumiChat and bundles their license notices. Full slice verification remains incomplete; PARITY.md records the current evidence. Checkpoints below preserve earlier investigation results and are not the current implementation inventory.

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

## Bare-domain linkification

`MarkdownBareDomains` applies the web utility's allowlist, filename exclusions,
code/link scanning, and Markdown escaping before Foundation parsing. Scheme URLs,
www hosts, emails, IP addresses, localhost and unknown TLDs are left to their
existing behavior. The transformation is display-only and never changes stored
messages. Existing task recognition uses the transformed source positions.

Tests cover domains with paths/query/fragments, punctuation, escaped path text,
code fences/inline code, titled links, excluded tokens, Unicode prose and native
link/task integration. All 202 Chat tests, Xcode app build/tests, iOS 17 compilation
and changed-file lint/format passed (`/tmp/apple-domain-*.log`). Full slice 10
remains incomplete: HTML/underline, emoji conversion, empty block preservation,
expansion, remaining syntax coverage/detection and visual verification remain.

## Long-message expansion implementation

`ExpandableMessageBody` measures 16 native body-font lines and clamps the entire
rich body to that height. The full content is measured independently of clipping;
Show more/Show less appears only for overflow or an expanded message. Geometry
observation tracks sizes, not scroll positions. The control resets on content
changes, matching the web hook, and jumbo emoji bypass the clamp. Attachment
exemptions belong with the upcoming attachment rendering slice.

Xcode app build/tests and changed-file lint/format passed
(`/tmp/apple-clamp-{app,lint,final-format}.log`). This is not final behavioral
verification: native expand/collapse, resize, selection and accessibility checks
remain required, including initial measurement and Markdown parse transitions.
No new interaction test has yet verified the expansion control.

## Signed app verification attempt

The Apple Development build passed (`/tmp/apple-rendering-signed.log`) and the
latest app was relaunched through CUA. The restored Everyone room exposed two
Show more controls with the accessibility value Collapsed for the existing
long reports. No messages were sent. The screenshot confirms normal recent
message rendering, but the reports were outside the visible viewport.

Interaction verification remains inconclusive: CUA rejected the report button
with an ambiguous-element refetch error, pointer scrolling with
`noWindowsAvailable`, and accessibility Scroll Up/scrollbar value changes had
no visible effect. This does not establish an app defect or successful
expand/collapse. Keep the manual/native interaction checks open; continue
independent rendering work instead of repeatedly attempting the same tool path.

## Native inline HTML formatting

Foundation marks inline HTML runs but preserves their literal tags. The shared
`MessageInlineHTML` pass now interprets b/strong, i/em, u and inline br tags,
including nested tags. Escaped tags and code retain their literal text. Underline
uses a portable custom attribute translated to SwiftUI's underline style in
paragraphs, headings and table cells. Underlined task-like text stays literal.

Verification: 206 Chat tests, Xcode app build/tests, iOS 17 compilation and
changed-file lint/format passed (`/tmp/apple-inline-html-*.log`). This is an
inline-formatting checkpoint, not an HTML sanitizer or complete HTML support.
Block HTML (including standalone br blocks), HTML links/code, disallowed-tag
handling, entities and native visual verification still need completion.

## Kotlin semantic coverage

The existing authored query now captures function/class/object/type-alias names,
referenced types, reification modifiers, and break/continue. The pinned generated
parser represents break/continue as identifiers; predicates recognize their exact
text without matching string contents. No grammar dependency changed. Tests cover
the semantic captures after an emoji, plus string literals containing the same
words. Verification: 207 Chat tests, iOS 17 shared compilation, Xcode app build/tests,
and changed-file SwiftFormat/SwiftLint passed (`/tmp/apple-kotlin-*.log`).

This extends native highlighting but does not complete Kotlin or registry parity.
String interpolation, annotations, language detection, remaining registry entries,
and the rich-text/visual checks above remain open.

## Proposed HTML parser dependency (approval pending)

Propose **SwiftSoup 2.13.9**, exact pin, library product `SwiftSoup` from
https://github.com/scinfu/SwiftSoup.git. Its release manifest uses Swift 6.0,
requires macOS 10.15/iOS 13 or newer, and declares no external dependencies.
The license is MIT. This is a Swift HTML parser, not a JavaScript runtime or
web view. Nothing has been added to package manifests yet.

Reuse assessment: Foundation Markdown remains the block/inline Markdown parser,
but its HTML runs retain raw markup rather than an HTML tree. The current
MessageInlineHTML handles only a few formatting tags. The approved TreeSitterHTML
product serves syntax highlighting and does not provide HTML entity decoding,
browser-style tree repair, or sanitization. A general handwritten HTML parser
would duplicate those responsibilities. SwiftSoup supplies that missing parser;
SwiftUI remains responsible for every rendered view.

The separate dependency PR would pin the library in SokosumiChat's test target,
add parsing/entity/malformed-input fixtures, and verify macOS and iOS 17 builds.
Fixtures should cover quoted/unquoted hrefs, entities, nested formatting,
malformed nesting and script/style content. No product rendering changes belong
in that prerequisite PR. Do not open or implement it without explicit approval.

After merge, slice 10 would use the parser to replace the limited inline HTML
pass and apply the web's actual allowed-tag/attribute/link policy. Do not assume
SwiftSoup's default whitelist equals sanitize-html's configured behavior. Compare
fixtures with web's installed sanitizer and Markdown pipeline, preserve code
literals and whitespace, and render allowed HTML as native text/block nodes.
Image/audio/video presentation remains in the attachment slice. No network fetch
or executable content is needed to parse message HTML.

Release evidence: [manifest](https://github.com/scinfu/SwiftSoup/blob/2.13.9/Package.swift),
[license](https://github.com/scinfu/SwiftSoup/blob/2.13.9/LICENSE).

## Structural parser audit (2026-09-10)

A fresh Foundation probe confirms that an empty fenced code block between two
paragraphs is omitted entirely. In a table with an empty middle row and an empty
last row, only the nonempty row survives (with rowIndex 2). A table whose header
and body cells are all empty produces an empty AttributedString. Therefore,
presentation-intent reconstruction cannot recover the complete source tree.

Reproduction inputs:

- `before\n\n```swift\n```\n\nafter`
- `| A | B |\n|---|---|\n| | |\n| x | y |\n| | |`
- `| | |\n|---|---|\n| | |`

The already-approved TreeSitterMarkdown parser was also tested using its current
SwiftTreeSitter binding. It preserves empty fenced blocks and the fully empty
table, but emits an ERROR node outside the table for the mixed table above.
It is not a reliable replacement for the structural Markdown parser based on
these fixtures. Probe output: `/tmp/apple-empty-structure.log`. The temporary
probe test was removed; no production parser or dependency changed.

Recommend extending the pending dependency proposal with **swift-markdown 0.8.0**
(product `Markdown`, swiftlang/swift-markdown). It exposes a full Markdown tree
backed by native cmark-gfm. Its manifest uses Swift tools 6.2 and declares
swift-cmark from 0.8.0 plus the build-time swift-docc-plugin from 1.1.0.
Resolved versions must be recorded and reviewed in the separate dependency PR.
The package license is Apache 2.0 with Runtime Library Exception; dependency
licenses must be included in that review. This still needs explicit approval.

Before integration, the prerequisite PR must prove all three fixtures preserve
blocks, rows and cells, cover nested lists/quotes and partial streamed fences,
and compile for iOS 17 and macOS. If verified, replace Foundation's lossy block
reconstruction with this tree; retain native AttributedString/SwiftUI output
and Tree-sitter for code highlighting. SwiftSoup remains separately responsible
for HTML fragments. Do not introduce a second full Markdown parse per message
or a sentinel-based repair pass to conceal missing blocks.

Manifest: https://github.com/swiftlang/swift-markdown/blob/0.8.0/Package.swift

## Kotlin annotations and braced interpolation

The native query recognizes ordinary/file annotations and braced string
interpolation. Annotation names use the native attribute color; duplicate generic
type captures at the same range are removed so they cannot overwrite that color.
Embedded expressions retain their nested number captures. Tests verify Unicode
ranges, escaped-dollar literals, annotation string arguments and final capture
precedence.

A probe found that Kotlin 1.1.0's generated parser emits simple `$name` templates
as string_content rather than interpolation. That gap remains open; braced
`${expression}` works. Do not treat this checkpoint as complete Kotlin parity or
add a grammar upgrade without the required dependency approval.

Verification: 208 Chat tests, Xcode app build/tests, iOS 17 shared compilation,
and changed-file lint/format passed (`/tmp/apple-interpolation-*.log`).

## Expansion accessibility verification follow-up

On 2026-09-10, CUA accessibility clicks succeeded in the existing signed app.
The Noodles report changed Collapsed → Expanded → Collapsed. Expanding the
Soupie report then left Noodles collapsed, verifying independent view state;
Soupie was restored to collapsed afterward. No messages were sent. The inspected
ExpandableMessageBody implementation is unchanged since that signed build.

This supersedes the earlier ambiguous-button result for accessibility activation
only. The screenshot still shows recent messages at the bottom, with both reports
outside the viewport. Therefore visual clipping, pointer hit testing, scrolling,
selection and resizing remain unverified. Do not treat accessibility state
transitions as proof of the on-screen expansion layout or the latest code colors.

## Visible thread expansion and window resizing

Opening the existing Noodles report through Reply in thread brought its parent
message into view without sending a message. The signed app screenshot showed
the collapsed report ending after the Engagement section, with Show more below.
Activating it exposed later sections through Findings and the task link, followed
by Show less. Collapsing restored the compact report and reply summary.

Window zoom enlarged the window while retaining Collapsed. Expanding at that
size changed the accessibility value to Expanded; restoring the original window
size preserved Expanded and showed the later report sections. One screenshot
request at the enlarged size failed with ScreenCaptureKit -3811; the screenshot
after restoring the window succeeded. The report was collapsed and the Everyone
room reopened afterward. These checks cover discrete window resizing, not a
continuous resize drag or scroll-performance profile.

This supersedes the earlier offscreen limitation for this report's thread view.
Native pointer text selection/copy, light-mode appearance, streaming layout and
latest syntax-color verification remain open. No messages or drafts were sent.

## Approved emoji data and conversion

The installed web pipeline is remark-emoji 5.0.2 → node-emoji 2.2.0 → emojilib
2.4.0 for shortcodes, plus emoticon 4.1.0 for ASCII faces. Do not substitute the
unrelated @lobehub/emojilib or the newer gemoji registry: those can differ from
what web actually renders.

PR #4374 added approved data-only JSON resources derived from emojilib 2.4.0's name/char
map and emoticon 4.1.0's ordered emoji/emoticons records. The extraction
measured 1,570 names (33,788 compact UTF-8 bytes) and 29 emoticon groups containing
322 spellings (2,889 compact UTF-8 bytes). Both installed sources include MIT
licenses (Mu-An Chiou and Titus Wormer respectively). Bundled notices preserve
those licenses; [emoji-data.md](emoji-data.md) records versions and content hashes.
Dependency tests verify both SHA-256 hashes. No npm runtime dependency is used.

The native algorithm must match remark-emoji's two ordered replacement passes:
shortcodes first, then emoticons, operating on Markdown text nodes rather than
code, destinations or raw HTML. Shortcodes are case-sensitive; unknown names
survive the shortcode pass but may contain matches for the subsequent emoticon
pass. Preserve the exact colon/token character rules and emoticon
boundary rules. For each emoticon match, web tries full match, dropping the last
character, dropping the first, then dropping both, preserving unmatched boundary
characters. Preserve record order, since first matching group wins. Padding and
accessible-wrapper options are disabled by the current web configuration.

Acceptance examples include `:smile:` → 😄, `:+1:` → 👍 and `:-)` → 😃. Use the
installed web pipeline to derive boundary/code/escaped/unknown fixtures and verify
native output, including spaces and punctuation. Converted shortcodes do not
retroactively trigger raw-message jumbo sizing. The integrated Markdown tree
preserves text-node boundaries for this pass; avoid applying replacement to
the raw message or to an entire flattened attributed paragraph.

## Remaining grammar packaging audit (2026-09-10)

The installed lowlight/common registry also includes GraphQL, which was missing
from the earlier gap list. The following upstream snapshots were inspected via
GitHub contents/commit APIs; none has been added to the project.

| Candidate | Inspected revision | Packaging findings |
| --- | --- | --- |
| [11bit/tree-sitter-graphql](https://github.com/11bit/tree-sitter-graphql) | `951bde9fb3145b5f676204231e35f8b21d21f7b3` | C sources, queries and LICENSE present; no SwiftPM manifest. |
| [codepen/tree-sitter-less](https://github.com/codepen/tree-sitter-less) | `fcd5b67b2979e8aa27bd12bbd39ae9435cc507eb` | C sources present; no SwiftPM manifest, queries directory or standalone license file in root. Licensing and highlight coverage require validation. |
| [CodeAnt-AI/tree-sitter-vb-dotnet](https://github.com/CodeAnt-AI/tree-sitter-vb-dotnet) | `cfca210ce8fdcb5245bd9cd5c47ce0a21a8488d5` | SwiftPM manifest exists but references an absent queries directory. No standalone license file in root. Do not treat as ready to adopt. |
| [wasm-lsp/tree-sitter-wasm](https://github.com/wasm-lsp/tree-sitter-wasm) | `2ca28a9f9d709847bf7a3de0942a84e912f59088` | WAT/WAST grammars and LICENSE; no SwiftPM manifest. |

Next validate licensing, native build compatibility and query coverage before
requesting a separate dependency PR. Arduino, PHP-template, Python REPL and shell
sessions also need verified treatment; adjacent grammars alone do not establish
parity. Language detection remains separate unfinished work. No new dependency
approval is implied by this audit.

### Validated GraphQL / LESS proposal

Temporary native probes on 2026-09-10, outside the project dependency graph:

- GraphQL: `11bit/tree-sitter-graphql` at `951bde9fb3145b5f676204231e35f8b21d21f7b3`, MIT with full notice present. No SwiftPM manifest: propose vendoring unchanged generated C/header/query sources plus license in a small C target inside the existing Chat package, recording the upstream revision. No new runtime.
- LESS: reject the codepen candidate (`UNLICENSED` in package.json). Use `mdovale/tree-sitter-less` at `02988c765d30adb0476657b5d220e8dfde1c07d3` instead. It includes SwiftPM, generated C parser/scanner, highlight queries and a full MIT notice. Pin the revision; reuse the existing SwiftTreeSitter version.
- Both compiled and ran against the installed Tree-sitter runtime: GraphQL query fixture produced 20 captures; LESS variables/nested selector fixture produced 27. Neither fixture had parse errors; both highlight queries compiled. Generated C sources also compiled for arm64 iOS 17. This is representative compatibility evidence, not exhaustive language validation.
- Probe files: `/tmp/apple-grammar-probe.c`, `/tmp/apple-grammar-probe`, and `/tmp/apple-grammar-audit-*-20260910` checkouts. Project manifests remain unchanged.

Request explicit approval for a separate GraphQL/LESS dependency PR before adding
these sources or packages. The PR must validate SwiftPM/macOS/iOS integration and
bundle the upstream notices. VB.NET/WAT/WAST, dialect/session handling and native
detection remain unfinished; this proposal does not reduce their parity scope.

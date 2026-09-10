# Slice 10: rich message rendering

## Rendering approach

Use Foundation `AttributedString(markdown:options:)` with full parsing in the UI-free SokosumiChat package. A local probe confirmed presentation intents for headings, paragraphs, nested list items, table rows/cells/alignment, and fenced-code language. SwiftUI views interpret these blocks in both room and thread messages. Preserve soft line breaks; handle task-list prefixes and sanitized inline underline markup explicitly. Keep ordinary links selectable and route them through the existing app URL policy.

Reuse MessageRow for shared room/thread presentation and the current streaming response content. Foundation does not perform syntax highlighting or emoji shortcode/emoticon conversion. There is no existing native renderer/highlighter in apps/apple.

## Proposed resource dependency PR — requires approval

Bundle the web renderer's existing pinned highlight.js 11.11.1 common language set, evaluated with system JavaScriptCore in a confined worker. Only the bundled engine is executable; message code is passed as data. Return token text/styles to SwiftUI, not an HTML view. Match web's explicit language and automatic detection behavior. No WebView, AppKit, network dependency, or Node runtime in the app.

Generate emoji lookup resources from the same node-emoji 2.2.0 and emoticon 4.1.0 resources used by remark-emoji 5.0.2. Preserve licenses and exact source versions. Provide a reproducible resource-generation command; generated assets must not be hand-edited. This adds third-party resources to the Apple app even though their npm versions already exist in the monorepo, so it requires the goal's separate dependency PR and explicit approval before incorporation.

The dependency PR should contain resource generation, licenses, the UI-free highlighting/lookup interface, and macOS/iOS17 compatibility tests. The subsequent slice 10 PR owns message parsing and SwiftUI integration. Do not add these resources until approved.

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

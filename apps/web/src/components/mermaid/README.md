# Chat Mermaid flowcharts

`ChannelMarkdownSegment` opts message bodies into `Markdown.enableMermaid`.
Room transcripts (including direct coworker/Soko Bot rooms), thread replies and
pinned message bodies share that path. Quoted previews and composer previews
remain code because they can be inside a button. Other shared Markdown consumers
(tasks, files, shared pages, etc.) remain unchanged. Native Apple renderers are
separate and are not changed here.

The adapter reads the original Markdown AST before display normalization and
protects each original Mermaid span with a placeholder. Placeholders are absent
from the source, transformed text (including decoded entities), and search term.
After display transforms, it restores each span and records its final UTF-16
offset. Only `pre` nodes at those recorded offsets receive Mermaid source;
there is no ordinal pairing between different parse trees. Fences exposed by
HTML sanitization stay ordinary code and cannot steal another diagram's source.
Original code values remain unchanged, including hostile text. It uses the
parser's fence boundary to distinguish an unfinished block from a closed block.
An unfinished block shows source and a quiet waiting message. A closed invalid,
unsupported, or oversized block shows a local explanation and copyable source.
No persistence or API code changes.

## Security boundary

Mermaid input and generated SVG are both untrusted. Do not replace the image
with inline SVG, inject it through `innerHTML`, call `bindFunctions`, permit
input-provided configuration, or relax the source policy without redoing browser
security verification.

- Only text-only `flowchart`/`graph` diagrams with an explicit direction are
  supported. Reject configuration/frontmatter/directives, HTML and entity
  syntax, Markdown labels, escapes, links/click handlers, images/icons, CSS,
  math and resource syntax **before** Mermaid can create measurement DOM.
  The intentionally conservative policy can reject harmless labels containing
  reserved words or punctuation (including `<`, `&`, `#`, `:`, `%`, `@`, backticks,
  and backslashes). Such input retains accessible source; this is not full
  Mermaid-language support.
- Initialize Mermaid 12.0.0 with `securityLevel: "strict"`, root
  `htmlLabels: false`, `startOnLoad: false`, and `suppressErrorRendering: true`.
  Lock security/configuration keys with `secure`. Never accept caller options.
  Use application-owned semantic color tokens, not diagram styles.
- Serialize initialization and rendering because Mermaid owns global state.
  Its temporary measurement container is hidden and removed in `finally`.
  Strict rendering plus prevalidation protects that live DOM stage; it is not
  a sandboxed worker or iframe.
- Check SVG resource references, then sanitize with the existing DOMPurify SVG
  profile. Remove scripts, foreign HTML, links, images, external references,
  reuse elements and animation elements. The CSS resource guard supplements
  DOMPurify, which does not sanitize CSS.
- Display the result only as an SVG Blob in an `img`. Browser SVG image mode is
  an additional boundary: SVG cannot execute scripts, navigate links, or fetch
  external resources. Source is rendered as React text. No CDN, external font,
  renderer API, or diagram upload is used. Revoke Blob URLs on replacement and
  unmount. Ignore obsolete async completions; cancelled queued work never renders.

Current official references, consulted 2026-09-25:
[Mermaid security](https://mermaid.js.org/community/security.html),
[securityLevel and secure](https://mermaid.js.org/config/schema-docs/config.html#securitylevel),
[htmlLabels](https://mermaid.js.org/config/schema-docs/config.html#htmllabels),
and [MDN SVG image restrictions](https://developer.mozilla.org/en-US/docs/Web/SVG/Guides/SVG_as_an_image#restrictions).
The documentation describes strict mode's HTML/click restrictions and `secure`
configuration keys. It recommends keeping Mermaid and dependencies updated.
Recheck these references and security advisories when updating the pinned version.

## Cost and loading

Per diagram: at most 4,000 UTF-16 code units, 200 identifier/word tokens, 100
lines and 50 edges (including Mermaid's own `maxEdges` guard). Per Markdown
message section: at most eight rendered diagrams; later blocks retain source.
Complete, policy-compliant blocks within 600px above/below the nearest scrolling
ancestor (or viewport) import Mermaid immediately. Leaving that band cancels
unfinished work; re-entry retries. Work stays serialized and yields to an idle
callback (100ms maximum wait, timer fallback) before each uncached layout.
Completed diagrams disconnect their observers. Source/theme changes cancel old
work without remounting the figure. Identical source, theme, font size and color
tokens reuse sanitized SVG in a page-local LRU cache: at most 16 entries, each at
most 65,536 UTF-16 code units (roughly 2 MiB total). Failures are not cached.
The inline preview reserves 16rem in both loading and ready states; its toolbar
and status line also retain space. Large diagrams scroll within that preview;
Enlarge remains available. Source starts collapsed for renderable complete
blocks, and open for partial/error blocks. User-opened source stays open when
the image arrives.
No renderer import occurs for ordinary code or unfinished blocks.

These are input/work bounds, not a hard wall-clock deadline. Mermaid's active
synchronous parser/layout work runs on the UI thread and cannot be interrupted
by AbortSignal; cancellation discards its result and prevents later queued work.
A dedicated execution process would be required for a hard CPU deadline.

## Interaction and verification

The image keeps readable intrinsic dimensions in a bounded, focusable scroll
region. Enlarge uses the shared Radix dialog for focus trapping, Escape and focus
return. Zoom controls span 50–300%. Source disclosure and clipboard copy remain
available, including a manual-copy error if clipboard access is denied. Theme
changes regenerate SVG using current tokens. All new copy is in en/de/es.

Colocated tests cover Markdown integration, lifecycle/races, source policy and
resource guards. happy-dom cannot faithfully run DOMPurify's SVG traversal;
real SVG sanitization is tested in Chromium in
`evidence/mermaid/browser-checks.mjs`. See `evidence/mermaid/README.md` for commands,
screenshots, observed results and unverified authenticated surfaces.

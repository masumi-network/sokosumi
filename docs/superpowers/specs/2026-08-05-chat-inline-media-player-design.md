# Design: Inline video and audio playback in chat

**Date:** 2026-08-05  
**Status:** Approved  
**Scope:** `apps/web` only (client render). No Core API or upload-pipeline changes.

## Problem

Video and audio attachments in chat (and other FileChip surfaces) render as download-only links. Users must leave the thread to play media. Images already open an in-app viewer; PDFs/office/text open DocumentViewer. Markdown has partial video support (`![](…mp4|webm|ogg)` → `<video controls>`) but no audio path and a hardcoded `type="video/mp4"`.

Screenshot reference: a Kling-generated `.mp4` appears as a file chip that downloads instead of playing inline.

## Goals

- Play **video and audio in place** with **native browser controls**.
- User starts playback (no forced autoplay).
- Cover **FileChip attachments** (primary) and **harden Markdown** (secondary).
- Reuse one classification path so chips and markdown do not drift.

## Non-goals

- Forced autoplay (including muted autoplay).
- Remark/rehype media plugins.
- YouTube/Vimeo/link-unfurl embeds (separate feature if needed later).
- Custom player UI beyond native `<video>` / `<audio>`.
- Server upload MIME allowlist or storage changes.
- Blob-fetch workaround for CDN `Content-Disposition` on media (v1); only if real breakage appears later (PDF already uses blob for iframe).

## Decisions (from brainstorming)

| Decision | Choice |
| --- | --- |
| Playback model | Inline player, native controls, user hits play |
| Surfaces | File chips **and** Markdown hardening |
| Layout | Always inline in message/output chips (not modal, not expand-on-click) |
| Markdown approach | Extend `react-markdown` `components` + shared classifier — **not** a remark plugin |
| Plugin for markdown only? | Rejected: FileChip never goes through remark; for `![](media)` component overrides are the correct layer |

## Architecture

### Shared classifier

Extend `apps/web/src/lib/utils/file-preview.ts` (same module as PDF/image classification).

```ts
interface FilePreviewClassification {
  isImage: boolean;
  isVideo: boolean;
  isAudio: boolean;
  documentKind: DocumentPreviewKind | null;
}
```

**Priority (mutually exclusive):**

1. Image  
2. Video  
3. Audio  
4. Document (`pdf` | `office` | `text`)  
5. Unsupported → plain download/open link  

**Detection inputs (any of):**

- Normalized MIME (`video/*`, `audio/*`, existing image/document checks)
- Extension from `url`
- Extension from `fileName` (extensionless blob keys)

**Positive allowlists:**

| Kind | Extensions | MIME |
| --- | --- | --- |
| Video | `mp4`, `webm`, `ogg`, `mov`, `m4v` | `video/*` (when present) |
| Audio | `mp3`, `wav`, `m4a`, `aac`, `flac`, `opus`, `oga` | `audio/*` (when present) |

**`.ogg` ambiguity:** Prefer MIME when present. Extension-only `.ogg` → **video** (matches existing Markdown behavior). Prefer `.oga` / `.opus` / `.mp3` etc. for audio-only files.

**Media `src` helper:** reuse `stripForcedDownloadParam(url)` so `?download=1` / `?download=true` does not force attachment disposition on the media element.

Keep helpers web-local in v1 (parallel to PDF helpers). Optional later: move `isVideoUrl` / `isAudioUrl` next to `isImageUrl` in `@sokosumi/utils` if other packages need them.

### Data flow

```text
attachment | markdown src
        ↓
classifyFilePreview(url, fileName?, mediaType?)
        ↓
  isVideo → <video controls preload="metadata" playsInline src={mediaSrc}>
  isAudio → <audio controls preload="metadata" src={mediaSrc}>
  isImage → existing ImageViewer path
  document  → existing DocumentViewer path
  else      → <a href> download/open
```

No new network protocol. Playback uses the existing public/blob URL already on the file part.

## Component changes

### FileChip (`apps/web/src/components/ui/file-chip.tsx`)

When `isVideo` or `isAudio`:

- Render an **inline player block**, not a download-only `<a>`.
- Show filename (and size when known).
- Native player:
  - Video: `<video controls preload="metadata" playsInline className="w-full max-w-* rounded-lg" src={mediaSrc} />`
  - Audio: `<audio controls preload="metadata" className="w-full" src={mediaSrc} />`
- Secondary **Download** affordance (link to original URL; reuse existing download copy where possible).
- No `autoplay`, no muted auto-start.
- `aria-label` (or equivalent) derived from filename.

Surfaces that pick this up automatically: chat message attachments, job detail inputs/outputs, any other `FileChip` consumer.

### FileChipMiniPreview (composer drafts)

**Out of scope for full players.** Composer draft chips stay compact (icon/thumb). Full inline players only on **sent** messages and job-output FileChips. Avoid noisy multi-player composers.

### Markdown (`apps/web/src/components/markdown.tsx`)

- Share detection via the same helpers (import from `file-preview`, not a second extension list).
- `img` component:
  - video URL → `<video controls preload="metadata" playsInline>`
  - audio URL → `<audio controls preload="metadata">`
  - else existing image
- Keep raw `video` component; add/align `audio` component with controls + consistent styling.
- Remove hardcoded `type="video/mp4"`; set `type` only when derived from a known extension, otherwise omit and let the browser sniff.

### i18n

Reuse existing download strings where possible (`Components.ImageViewer` / `DocumentViewer` download keys or a small shared media-chip string). Add keys only if no suitable string exists.

## Edge cases

| Case | Behavior |
| --- | --- |
| Unsupported codec / decode failure | Empty native player; Download remains usable |
| `Content-Disposition: attachment` | Strip `download` query param; rely on native media (v1). Blob-fetch only if production proves play fails (follow-up, patterned on DocumentViewer) |
| Large files | `preload="metadata"` only |
| Multiple media in one message | Independent players; no global single-player lock in v1 |
| CORS / private URL | Same constraints as images today; download remains |
| zip / unknown binary | Unchanged plain download link |
| Extensionless blob key | MIME from attachment/`HEAD` or `fileName` fallback (existing FileChipWithMetadata path) |

## Testing

1. **`file-preview.test.ts`**
   - Classify video/audio by extension, MIME, and `fileName` fallback
   - Priority: image wins over video/audio; video before audio when both impossible; zip still neither image nor media nor document
   - `.ogg` extension-only → video; `audio/ogg` MIME → audio

2. **`file-chip.test.ts`**
   - `.mp4` / `video/*` renders `<video>`, not a plain external link
   - `.mp3` / `audio/*` renders `<audio>`
   - Download secondary control present
   - `.zip` still plain download/open link
   - Image and document paths unchanged

3. **Markdown**
   - Unit/smoke: `![](…mp4)` → video; audio extension → audio; image unchanged
   - Add tests only if a lightweight harness already exists; otherwise minimal component test colocated with markdown

## Implementation sketch (for planning)

1. Extend `file-preview.ts` + unit tests (classifier first).
2. FileChip inline media branch + tests.
3. Markdown component harden + shared helpers.
4. i18n only if needed.
5. Manual check: chat attachment mp4/mp3, markdown image-syntax media, zip still downloads.

## Risks

| Risk | Mitigation |
| --- | --- |
| CDN forces download on media element | v1 strip query; document follow-up blob path if needed |
| Long videos bloat timeline | max-width + native controls; accept height cost (product choice: always-inline) |
| Format matrix sprawl | Positive allowlist only; unknown stays download |
| Classifier API break for existing callers | Additive fields; update all `classifyFilePreview` destructuring sites |

## Out of scope follow-ups

- Remark plugin for bare-URL media unfurl
- Blob URL path for media when CDN disposition blocks playback
- Moving video/audio URL helpers into `@sokosumi/utils`
- Composer mini-preview inline players
- Single-player “only one plays at a time” coordination

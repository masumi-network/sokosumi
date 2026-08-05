# Chat Inline Video/Audio Player Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Play video and audio attachments inline in chat (and other FileChip surfaces) with native controls, and harden Markdown media rendering — no autoplay, no remark plugin.

**Architecture:** Extend the existing `classifyFilePreview` allowlist in `file-preview.ts` with `isVideo` / `isAudio`. FileChip renders native `<video>` / `<audio>` for those kinds. Markdown `components` reuse the same helpers for `img` / `video` / `audio`. Composer mini-previews stay compact (no full players).

**Tech Stack:** TypeScript, React 19, Next.js App Router (`apps/web`), Vitest + Testing Library, next-intl, existing `react-markdown` + `rehype-raw` (no new deps).

**Spec:** `docs/superpowers/specs/2026-08-05-chat-inline-media-player-design.md`

## Global Constraints

- No forced autoplay (no `autoplay` attribute; user starts playback)
- No new npm dependencies / remark media plugins
- Positive allowlists only — unknown types stay download links
- Priority: image → video → audio → document → download
- `.ogg` extension-only → video; `audio/*` MIME (including `audio/ogg`) → audio
- Media `src` must pass through `stripForcedDownloadParam`
- FileChipMiniPreview: no full players (composer drafts stay compact)
- Web-only (`apps/web`); no Core API / upload pipeline changes
- Pin no new deps; Biome format; Conventional Commits
- When adding i18n keys, update `en.json`, `de.json`, `es.json`

## File map

| File | Responsibility |
| --- | --- |
| `apps/web/src/lib/utils/file-preview.ts` | Video/audio allowlists, `isVideo*` / `isAudio*` helpers, extend `classifyFilePreview` |
| `apps/web/src/lib/utils/__tests__/file-preview.test.ts` | Classifier unit tests |
| `apps/web/src/components/ui/file-chip.tsx` | Inline `<video>` / `<audio>` + download secondary |
| `apps/web/src/components/ui/__tests__/file-chip.test.tsx` | FileChip media tests |
| `apps/web/src/components/markdown.tsx` | Shared media detection for `img` / `video` / `audio` |
| `apps/web/src/components/__tests__/markdown-media.test.tsx` | Markdown media smoke tests (create) |
| `apps/web/messages/en.json` (and `de.json`, `es.json`) | Optional `Components.FileChip` download labels if needed |

**Do not modify for full players:** `file-chip-mini-preview.tsx` (compact only).  
**Call sites that only read `isImage` / `documentKind`:** `room-message-row.tsx`, `file-chip-mini-preview.tsx` — no logic change required if new fields are additive.

---

### Task 1: Classifier — video/audio in `file-preview.ts` (TDD)

**Files:**
- Modify: `apps/web/src/lib/utils/file-preview.ts`
- Modify: `apps/web/src/lib/utils/__tests__/file-preview.test.ts`

**Interfaces:**
- Consumes: `getExtensionFromUrl`, `isImageUrl`, `normalizeMediaType` (existing)
- Produces:
  - `isVideoUrl(url: string): boolean`
  - `isVideoMediaType(mediaType?: string | null): boolean`
  - `isAudioUrl(url: string): boolean`
  - `isAudioMediaType(mediaType?: string | null): boolean`
  - `FilePreviewClassification` with `isImage`, `isVideo`, `isAudio`, `documentKind`
  - `classifyFilePreview(url, fileName?, mediaType?): FilePreviewClassification` with priority image → video → audio → document → none

- [ ] **Step 1: Write failing tests**

Append / update in `apps/web/src/lib/utils/__tests__/file-preview.test.ts`:

```typescript
import {
  classifyFilePreview,
  // ...existing imports...
  isAudioMediaType,
  isAudioUrl,
  isVideoMediaType,
  isVideoUrl,
} from "@/lib/utils/file-preview";

describe("isVideoUrl / isVideoMediaType", () => {
  it("recognizes video extensions", () => {
    expect(isVideoUrl("https://blob.example/clip.mp4")).toBe(true);
    expect(isVideoUrl("https://blob.example/clip.webm")).toBe(true);
    expect(isVideoUrl("https://blob.example/clip.ogg")).toBe(true);
    expect(isVideoUrl("https://blob.example/clip.mov")).toBe(true);
    expect(isVideoUrl("https://blob.example/clip.m4v")).toBe(true);
    expect(isVideoUrl("https://blob.example/clip.mp3")).toBe(false);
  });

  it("recognizes video/* MIME types", () => {
    expect(isVideoMediaType("video/mp4")).toBe(true);
    expect(isVideoMediaType("VIDEO/WEBM; codecs=vp9")).toBe(true);
    expect(isVideoMediaType("audio/mp4")).toBe(false);
    expect(isVideoMediaType(null)).toBe(false);
  });
});

describe("isAudioUrl / isAudioMediaType", () => {
  it("recognizes audio extensions", () => {
    expect(isAudioUrl("https://blob.example/track.mp3")).toBe(true);
    expect(isAudioUrl("https://blob.example/track.wav")).toBe(true);
    expect(isAudioUrl("https://blob.example/track.m4a")).toBe(true);
    expect(isAudioUrl("https://blob.example/track.aac")).toBe(true);
    expect(isAudioUrl("https://blob.example/track.flac")).toBe(true);
    expect(isAudioUrl("https://blob.example/track.opus")).toBe(true);
    expect(isAudioUrl("https://blob.example/track.oga")).toBe(true);
    // .ogg is video-extension allowlist, not audio
    expect(isAudioUrl("https://blob.example/track.ogg")).toBe(false);
    expect(isAudioUrl("https://blob.example/clip.mp4")).toBe(false);
  });

  it("recognizes audio/* MIME types", () => {
    expect(isAudioMediaType("audio/mpeg")).toBe(true);
    expect(isAudioMediaType("audio/ogg")).toBe(true);
    expect(isAudioMediaType("audio/ogg; codecs=opus")).toBe(true);
    expect(isAudioMediaType("video/mp4")).toBe(false);
    expect(isAudioMediaType(null)).toBe(false);
  });
});

describe("classifyFilePreview", () => {
  // Update EVERY existing expectation to include isVideo: false, isAudio: false
  // when those flags are false. Example:
  it("classifies an image by URL extension", () => {
    expect(classifyFilePreview("https://blob.example/photo.png")).toEqual({
      isImage: true,
      isVideo: false,
      isAudio: false,
      documentKind: null,
    });
  });

  it("classifies video by extension", () => {
    expect(classifyFilePreview("https://blob.example/clip.mp4")).toEqual({
      isImage: false,
      isVideo: true,
      isAudio: false,
      documentKind: null,
    });
  });

  it("classifies video by mediaType when URL has no extension", () => {
    expect(
      classifyFilePreview("https://blob.example/abcdef", null, "video/mp4"),
    ).toEqual({
      isImage: false,
      isVideo: true,
      isAudio: false,
      documentKind: null,
    });
  });

  it("classifies video via fileName fallback", () => {
    expect(
      classifyFilePreview("https://blob.example/abcdef", "movie.mp4"),
    ).toEqual({
      isImage: false,
      isVideo: true,
      isAudio: false,
      documentKind: null,
    });
  });

  it("classifies audio by extension", () => {
    expect(classifyFilePreview("https://blob.example/track.mp3")).toEqual({
      isImage: false,
      isVideo: false,
      isAudio: true,
      documentKind: null,
    });
  });

  it("classifies audio by mediaType (including audio/ogg)", () => {
    expect(
      classifyFilePreview("https://blob.example/abcdef", null, "audio/ogg"),
    ).toEqual({
      isImage: false,
      isVideo: false,
      isAudio: true,
      documentKind: null,
    });
  });

  it("treats extension-only .ogg as video", () => {
    expect(classifyFilePreview("https://blob.example/clip.ogg")).toEqual({
      isImage: false,
      isVideo: true,
      isAudio: false,
      documentKind: null,
    });
  });

  it("prefers image over video when both could match", () => {
    // image/* MIME wins even if filename looks like video (defensive)
    expect(
      classifyFilePreview(
        "https://blob.example/file",
        "file.mp4",
        "image/png",
      ),
    ).toEqual({
      isImage: true,
      isVideo: false,
      isAudio: false,
      documentKind: null,
    });
  });

  it("classifies unsupported file types as neither image, media, nor document", () => {
    expect(classifyFilePreview("https://blob.example/archive.zip")).toEqual({
      isImage: false,
      isVideo: false,
      isAudio: false,
      documentKind: null,
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter web test src/lib/utils/__tests__/file-preview.test.ts
```

Expected: FAIL — missing `isVideoUrl` / new classification fields.

- [ ] **Step 3: Implement classifier**

In `apps/web/src/lib/utils/file-preview.ts`, add after the text-preview constants:

```typescript
const VIDEO_EXTENSIONS = new Set(["mp4", "webm", "ogg", "mov", "m4v"]);
const AUDIO_EXTENSIONS = new Set([
  "mp3",
  "wav",
  "m4a",
  "aac",
  "flac",
  "opus",
  "oga",
]);

export function isVideoUrl(url: string): boolean {
  return VIDEO_EXTENSIONS.has(getExtensionFromUrl(url));
}

export function isVideoMediaType(mediaType?: string | null): boolean {
  return normalizeMediaType(mediaType)?.startsWith("video/") ?? false;
}

export function isAudioUrl(url: string): boolean {
  return AUDIO_EXTENSIONS.has(getExtensionFromUrl(url));
}

export function isAudioMediaType(mediaType?: string | null): boolean {
  return normalizeMediaType(mediaType)?.startsWith("audio/") ?? false;
}
```

Update the interface and classifier:

```typescript
export interface FilePreviewClassification {
  isImage: boolean;
  isVideo: boolean;
  isAudio: boolean;
  documentKind: DocumentPreviewKind | null;
}

/**
 * Classifies a file for chip/markdown preview: image, video, audio,
 * previewable document, or none (download link). Falls back to `fileName`
 * when `url` has no useful extension.
 */
export function classifyFilePreview(
  url: string,
  fileName?: string | null,
  mediaType?: string | null,
): FilePreviewClassification {
  const isImage =
    (normalizeMediaType(mediaType)?.startsWith("image/") ?? false) ||
    isImageUrl(url) ||
    (fileName ? isImageUrl(fileName) : false);

  if (isImage) {
    return {
      isImage: true,
      isVideo: false,
      isAudio: false,
      documentKind: null,
    };
  }

  const isVideo =
    isVideoMediaType(mediaType) ||
    isVideoUrl(url) ||
    (fileName ? isVideoUrl(fileName) : false);

  if (isVideo) {
    return {
      isImage: false,
      isVideo: true,
      isAudio: false,
      documentKind: null,
    };
  }

  const isAudio =
    isAudioMediaType(mediaType) ||
    isAudioUrl(url) ||
    (fileName ? isAudioUrl(fileName) : false);

  if (isAudio) {
    return {
      isImage: false,
      isVideo: false,
      isAudio: true,
      documentKind: null,
    };
  }

  const documentKind =
    getDocumentPreviewKind(url, mediaType) ??
    (fileName ? getDocumentPreviewKind(fileName, mediaType) : null);

  return {
    isImage: false,
    isVideo: false,
    isAudio: false,
    documentKind,
  };
}
```

Also update the comment on `getDocumentPreviewKind` that still says “video must keep falling through” — video is now classified elsewhere; leave document helper returning null for video (still correct).

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter web test src/lib/utils/__tests__/file-preview.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/utils/file-preview.ts apps/web/src/lib/utils/__tests__/file-preview.test.ts
git commit -m "feat(web): classify video and audio for file preview"
```

---

### Task 2: FileChip — inline native players (TDD)

**Files:**
- Modify: `apps/web/src/components/ui/file-chip.tsx`
- Modify: `apps/web/src/components/ui/__tests__/file-chip.test.tsx`
- Modify (if needed): `apps/web/messages/en.json`, `de.json`, `es.json`

**Interfaces:**
- Consumes: `classifyFilePreview` → `{ isImage, isVideo, isAudio, documentKind }`; `stripForcedDownloadParam`
- Produces: FileChip UI branch for video/audio with native controls + download link

- [ ] **Step 1: Write failing tests**

Add to `apps/web/src/components/ui/__tests__/file-chip.test.tsx`:

```typescript
  it("renders an inline video player for video files instead of a download link", () => {
    const { container } = render(
      <FileChip
        url="https://blob.example.com/uploads/clip.mp4?download=1"
        fileName="clip.mp4"
      />,
    );

    expect(screen.queryByRole("link", { name: /clip\.mp4/i })).not.toBeInTheDocument();

    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    expect(video).toHaveAttribute(
      "src",
      "https://blob.example.com/uploads/clip.mp4",
    );
    expect(video).toHaveAttribute("controls");
    expect(video).not.toHaveAttribute("autoplay");
    // download secondary still available
    expect(screen.getByRole("link", { name: /download/i })).toHaveAttribute(
      "href",
      "https://blob.example.com/uploads/clip.mp4?download=1",
    );
  });

  it("renders an inline audio player for audio files", () => {
    const { container } = render(
      <FileChip
        url="https://blob.example.com/uploads/track.mp3"
        fileName="track.mp3"
        mediaType="audio/mpeg"
      />,
    );

    const audio = container.querySelector("audio");
    expect(audio).not.toBeNull();
    expect(audio).toHaveAttribute(
      "src",
      "https://blob.example.com/uploads/track.mp3",
    );
    expect(audio).toHaveAttribute("controls");
    expect(audio).not.toHaveAttribute("autoplay");
  });

  it("keeps a plain download/open link for unsupported file types", () => {
    // existing zip test — ensure it still does not render video/audio
    render(
      <FileChip
        url="https://blob.example.com/uploads/archive.zip"
        fileName="archive.zip"
      />,
    );
    expect(document.querySelector("video")).toBeNull();
    expect(document.querySelector("audio")).toBeNull();
  });
```

Mock next-intl: if using a new `Components.FileChip` namespace, extend the existing mock:

```typescript
if (namespace === "Components.FileChip") {
  const labels: Record<string, string> = {
    download: "Download",
    playVideo: "Video {fileName}",
    playAudio: "Audio {fileName}",
  };
  if (key === "playVideo" || key === "playAudio") {
    return labels[key].replace("{fileName}", String(values?.fileName ?? ""));
  }
  return labels[key] ?? key;
}
```

Alternatively reuse `Components.DocumentViewer` `download` key (`"Download"`) already mocked — prefer that to avoid new i18n if product accepts generic “Download”.

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter web test src/components/ui/__tests__/file-chip.test.tsx
```

Expected: FAIL — video still renders as external link / no `<video>`.

- [ ] **Step 3: Implement FileChip media branch**

In `file-chip.tsx`:

1. Import `stripForcedDownloadParam` from `@/lib/utils/file-preview`.
2. Destructure `isVideo`, `isAudio` from `classifyFilePreview`.
3. After image / document branches, before the plain `<a>`:

```tsx
  if (isVideo || isAudio) {
    const mediaSrc = stripForcedDownloadParam(url);
    return (
      <div
        className={cn(
          "flex w-full max-w-full flex-col gap-2 rounded-md border p-2",
          className,
        )}
        data-testid={isVideo ? "file-chip-video" : "file-chip-audio"}
      >
        <div className="flex min-w-0 items-center gap-3">
          <div
            className={cn(
              "bg-accent/50 relative flex shrink-0 items-center justify-center rounded",
              containerSizeClass,
              shouldApplyIconPadding && "p-1",
            )}
          >
            <FileTypeIcon
              extension={getExtensionFromUrl(fileNameProp ?? url) || "file"}
            />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{fileName}</div>
            {prettySize ? (
              <div className="text-muted-foreground truncate text-xs">
                {prettySize}
              </div>
            ) : null}
          </div>
          <a
            href={url}
            target="_blank"
            rel="noreferrer noopener"
            className="text-muted-foreground hover:text-foreground shrink-0 text-xs underline underline-offset-2"
          >
            {/* useTranslations("Components.DocumentViewer") download, or FileChip.download */}
            Download
          </a>
        </div>
        {isVideo ? (
          <video
            src={mediaSrc}
            controls
            playsInline
            preload="metadata"
            className="w-full max-w-3xl rounded-lg"
            aria-label={fileName}
          >
            <a href={url}>Download video</a>
          </video>
        ) : (
          <audio
            src={mediaSrc}
            controls
            preload="metadata"
            className="w-full"
            aria-label={fileName}
          >
            <a href={url}>Download audio</a>
          </audio>
        )}
      </div>
    );
  }
```

Use `useTranslations` for the Download label (reuse `Components.DocumentViewer` `download` = `"Download"` to avoid new keys). Wire the same string into the test mock already present for DocumentViewer.

Do **not** set `autoplay`.

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter web test src/components/ui/__tests__/file-chip.test.tsx
```

Expected: PASS (including existing image/document/zip cases).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/ui/file-chip.tsx apps/web/src/components/ui/__tests__/file-chip.test.tsx apps/web/messages/*.json
git commit -m "feat(web): inline video and audio players in FileChip"
```

---

### Task 3: Markdown — harden media components (TDD)

**Files:**
- Modify: `apps/web/src/components/markdown.tsx`
- Create: `apps/web/src/components/__tests__/markdown-media.test.tsx`

**Interfaces:**
- Consumes: `isVideoUrl`, `isAudioUrl`, `stripForcedDownloadParam` from `@/lib/utils/file-preview`
- Produces: `img` → video/audio/image; `video` and `audio` components with controls, no autoplay

- [ ] **Step 1: Write failing tests**

Create `apps/web/src/components/__tests__/markdown-media.test.tsx`:

```tsx
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import Markdown from "@/components/markdown";

describe("Markdown media", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders a video element for markdown images that point at video files", () => {
    const { container } = render(
      <Markdown>
        {"![demo](https://blob.example.com/clip.mp4?download=1)"}
      </Markdown>,
    );

    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    expect(video).toHaveAttribute(
      "src",
      "https://blob.example.com/clip.mp4",
    );
    expect(video).toHaveAttribute("controls");
    expect(video).not.toHaveAttribute("autoplay");
    expect(container.querySelector("img")).toBeNull();
  });

  it("renders an audio element for markdown images that point at audio files", () => {
    const { container } = render(
      <Markdown>{"![track](https://blob.example.com/track.mp3)"}</Markdown>,
    );

    const audio = container.querySelector("audio");
    expect(audio).not.toBeNull();
    expect(audio).toHaveAttribute(
      "src",
      "https://blob.example.com/track.mp3",
    );
    expect(audio).toHaveAttribute("controls");
    expect(container.querySelector("img")).toBeNull();
  });

  it("keeps normal images as img", () => {
    const { container } = render(
      <Markdown>{"![photo](https://blob.example.com/photo.png)"}</Markdown>,
    );

    expect(container.querySelector("img")).not.toBeNull();
    expect(container.querySelector("video")).toBeNull();
    expect(container.querySelector("audio")).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter web test src/components/__tests__/markdown-media.test.tsx
```

Expected: FAIL on audio (and possibly video `src` still has `?download=1` / hardcoded type).

- [ ] **Step 3: Implement Markdown media helpers**

Replace the ad-hoc extension regex in `markdown.tsx` with shared helpers:

```tsx
import {
  isAudioUrl,
  isVideoUrl,
  stripForcedDownloadParam,
} from "@/lib/utils/file-preview";

// inside components:
img: ({ src, alt, ...props }) => {
  const srcString = typeof src === "string" ? src : undefined;
  if (srcString && isVideoUrl(srcString)) {
    const mediaSrc = stripForcedDownloadParam(srcString);
    return (
      <video
        src={mediaSrc}
        controls
        playsInline
        preload="metadata"
        className="w-full max-w-3xl rounded-lg"
        aria-label={alt || undefined}
      >
        <a href={srcString}>{"Download video"}</a>
      </video>
    );
  }
  if (srcString && isAudioUrl(srcString)) {
    const mediaSrc = stripForcedDownloadParam(srcString);
    return (
      <audio
        src={mediaSrc}
        controls
        preload="metadata"
        className="w-full max-w-3xl"
        aria-label={alt || undefined}
      >
        <a href={srcString}>{"Download audio"}</a>
      </audio>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} className="max-w-full rounded-lg" {...props} />
  );
},
video: ({ children, src, ...props }) => {
  const srcString = typeof src === "string" ? stripForcedDownloadParam(src) : src;
  return (
    <video
      {...props}
      src={srcString}
      className="w-full max-w-3xl rounded-lg"
      controls
      playsInline
      preload="metadata"
    >
      {children}
    </video>
  );
},
audio: ({ children, src, ...props }) => {
  const srcString = typeof src === "string" ? stripForcedDownloadParam(src) : src;
  return (
    <audio
      {...props}
      src={srcString}
      className="w-full max-w-3xl"
      controls
      preload="metadata"
    >
      {children}
    </audio>
  );
},
```

Remove hardcoded `type="video/mp4"` and the local `/\.(mp4|webm|ogg)$/i` regex.

Do **not** force `autoplay` even if present on raw HTML props from untrusted markdown — strip it:

```tsx
video: ({ children, src, autoPlay: _autoPlay, ...props }) => { /* ... */ },
audio: ({ children, src, autoPlay: _autoPlay, ...props }) => { /* ... */ },
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter web test src/components/__tests__/markdown-media.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/markdown.tsx apps/web/src/components/__tests__/markdown-media.test.tsx
git commit -m "feat(web): harden markdown video and audio rendering"
```

---

### Task 4: Regression pass + typecheck

**Files:**
- None expected; fix any fallout from additive `FilePreviewClassification` fields

**Interfaces:**
- Consumes: full Task 1–3 surface
- Produces: green targeted + related suites

- [ ] **Step 1: Run related unit tests**

```bash
pnpm --filter web test \
  src/lib/utils/__tests__/file-preview.test.ts \
  src/components/ui/__tests__/file-chip.test.tsx \
  src/components/ui/__tests__/file-chip-mini-preview.test.tsx \
  src/components/__tests__/markdown-media.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Typecheck web**

```bash
pnpm --filter web typecheck
```

Expected: PASS. If a caller spreads/exhaustiveness-checks `FilePreviewClassification`, update destructuring only — do not change mini-preview to full players.

- [ ] **Step 3: Manual checklist (if local app running)**

1. Chat attachment `.mp4` → inline video with controls; play works; Download works  
2. Chat attachment `.mp3` → inline audio  
3. Markdown `![](…mp4)` / `![](…mp3)` → players  
4. PDF / image / zip chips unchanged  
5. Composer draft chip for video stays compact (mini preview)

- [ ] **Step 4: Final commit only if fixes needed**

```bash
git add -A
git commit -m "fix(web): polish inline media player fallout"
```

---

## Self-review (plan vs spec)

| Spec requirement | Task |
| --- | --- |
| Inline native players, user starts play | Task 2, 3 |
| FileChip attachments | Task 2 |
| Markdown harden (video + audio) | Task 3 |
| Shared classifier / no remark plugin | Task 1 |
| Priority image → video → audio → document | Task 1 |
| `.ogg` → video; `audio/ogg` → audio | Task 1 |
| `stripForcedDownloadParam` on media src | Task 2, 3 |
| No autoplay | Task 2, 3 (explicit) |
| Mini preview no full player | File map + Task 2 scope |
| Tests for classifier + FileChip + markdown | Tasks 1–3 |
| No blob-fetch v1 | Not in plan (correct) |
| No new deps | Global constraints |

**Placeholder scan:** none.  
**Type consistency:** `FilePreviewClassification` fields match across tasks; helpers `isVideoUrl` / `isAudioUrl` / `stripForcedDownloadParam` names stable.

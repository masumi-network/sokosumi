# Coworker Metadata

How to structure the `metadata` for a coworker so it shows up correctly in the
agents marketplace and the New Task picker — the public **profile** (model /
hosting / capabilities) and the **Ready-To-Run Tasks** (offers) with their
example-output previews.

- **Source of truth:** `apps/core/src/schemas/coworker.schema.ts`
  (`coworkerMetadataSchema`). This document mirrors that schema; if they ever
  disagree, the schema wins.
- **Where it lives:** the `Coworker.metadata` column (a JSON column). Editing
  metadata is pure data — **no migration** is needed.
- **How it's validated:** every coworker the API returns is parsed against the
  schema. **Invalid metadata on a single coworker makes the coworker list fail
  to load** — so keep it valid.

---

## Quick start (minimal valid metadata)

```json
{
  "channels": { "email": "agent@example.com" }
}
```

`channels` is the only required key. Everything else (`profile`, `offers`) is
optional and only enriches the UI.

---

## Top-level structure

```jsonc
{
  "channels": { ... },   // REQUIRED — contact channels
  "profile":  { ... },   // optional — public profile shown when picking a coworker
  "offers":   [ ... ]    // optional — the "Ready-To-Run Tasks"
}
```

| Key | Required | Type | Purpose |
| --- | --- | --- | --- |
| `channels` | ✅ | object (string → string) | Contact channels keyed by provider |
| `profile` | — | object | Model / hosting / capabilities / examples |
| `offers` | — | array | Pre-filled task offers (cards + previews) |

---

## `channels`

A map of provider id → value. Keys are free-form; common ones are `email` and
`whatsapp`.

```json
"channels": {
  "email": "hannah@example.com",
  "whatsapp": "+49 151 0000000"
}
```

> ⚠️ Values are plain strings. Use a bare address — **not** a Markdown link.
> ✅ `"email": "hannah@example.com"`
> ❌ `"email": "[hannah@example.com](mailto:hannah@example.com)"`

---

## `profile`

Shown in the agent selection UI. All fields optional.

```json
"profile": {
  "llm": ["GPT-4o", "Claude 3.5 Sonnet"],
  "hosting": "EU · Frankfurt",
  "capabilities": ["Market Research", "Copywriting"],
  "examples": ["Plan a multi-channel campaign"]
}
```

| Field | Type | Renders as |
| --- | --- | --- |
| `llm` | string[] | Model chips, each with an auto-detected brand icon |
| `hosting` | string | A chip with an auto-detected region flag |
| `capabilities` | string[] | Capability tags |
| `examples` | string[] | Example prompts |

### Model icons are automatic

You write the model name as a string; the icon is matched by a keyword in it
(case-insensitive, first match wins). The **text you write is what's shown** —
write it nicely (`"Claude 3.5 Sonnet"`), the icon is derived.

| If the string contains… | Icon |
| --- | --- |
| `gpt`, `chatgpt`, `openai`, `dall-e`, `sora` | OpenAI |
| `claude`, `anthropic` | Claude |
| `mistral`, `mixtral`, `codestral` | Mistral |
| `gemini`, `gemma`, `bard`, `palm`, `google` | Gemini |
| `llama`, `meta` | Llama / Meta |
| `deepseek` | DeepSeek |
| `grok`, `xai` | Grok / xAI |
| `qwen`, `tongyi`, `alibaba` | Qwen |
| `cohere`, `command-r` | Cohere Command R |
| `perplexity`, `sonar`, `pplx` | Perplexity |
| `amazon`, `bedrock`, `titan` | Amazon Titan |
| `phi`, `copilot`, `microsoft` | Microsoft |

No match → the chip shows just the text (no icon). To add a provider, extend
`BRAND_RULES` in `apps/web/src/components/agents/tag-icon.tsx`.

`hosting` resolves to a **region flag** when a known region is recognized
(e.g. `"EU · Frankfurt"` → 🇪🇺), otherwise text only.

---

## `offers` (Ready-To-Run Tasks)

Each entry is one task card. Only `title` and `prompt` are required.

```jsonc
{
  "title":       "Competitive analysis",        // REQUIRED — card title
  "prompt":      "Run a competitive analysis…",  // REQUIRED — prefilled into the editor
  "category":    "Research",                     // optional — theming (see below)
  "description": "A sourced, side-by-side…",      // optional — shown on the card + preview
  "deliverable": "A 2–3 page PDF brief…",         // optional — "Deliverable" box in the preview
  "outputs":     [ ... ]                          // optional — example preview(s)
}
```

| Field | Required | Type | Purpose |
| --- | --- | --- | --- |
| `title` | ✅ | string | Card title |
| `prompt` | ✅ | string | Pre-filled into the task editor when picked |
| `category` | — | string | Drives icon / accent color / placeholder mock |
| `description` | — | string | Short blurb on the card and in the preview |
| `deliverable` | — | string | "What you get" line in the preview |
| `outputs` | — | array | Example outputs shown in the preview |

### `category`

Known categories get a themed icon, accent color, and placeholder mock. Spell
them exactly. Any other string still works but renders **neutral** (generic icon,
muted color).

| `category` | Icon | Accent | Placeholder mock |
| --- | --- | --- | --- |
| `Research` | bar chart | chart-1 | bar-chart skeleton |
| `Planning` | checklist | chart-4 | checklist |
| `Coordination` | people | chart-5 | checklist |
| `Engineering` | code | chart-3 | code block |
| `Presentations` | slides | chart-2 | slide |
| `Prototyping` | boxes | chart-1 | wireframe |
| `Writing` | pen | chart-3 | text lines |
| `Social` | clapperboard | chart-2 | video frame |

The placeholder mock is only shown when there's no real file output (i.e. a
`text` output or no `outputs`). With a real file, the thumbnail reflects the file
instead; the category still sets the accent color and the chip.

---

## `outputs` — example previews

`outputs` is an **array**. Each entry is one file/item. **Multiple outputs render
as switchable tabs** in the preview; the **first** output is the card thumbnail
and the default tab.

```jsonc
{ "type": "pdf", "url": "https://…/file.pdf", "label": "Competitive brief" }
```

| Field | Required | Type | Purpose |
| --- | --- | --- | --- |
| `type` | ✅ | enum (see below) | What kind of output it is |
| `url` | — | string | Link to a hosted file |
| `text` | — | string | Inline content (Markdown for `text`, HTML for `html`) |
| `label` | — | string | Tab / chip name (defaults to the type) |

### Output types

| `type` | Renders as | Provide |
| --- | --- | --- |
| `pdf` | inline PDF viewer | `url` |
| `image` | image | `url` |
| `slides` | presentation (Office viewer) | `url` (pptx) |
| `doc` | document (Office viewer) | `url` (docx) |
| `sheet` | spreadsheet (Office viewer) | `url` (xlsx/csv) |
| `text` | rendered **Markdown** | `text` |
| `html` | **sandboxed iframe** (scripts run) | `url` or `text` |

### Always use the canonical `type` value

The `type` MUST be one of these exact values:

> `pdf` · `image` · `slides` · `doc` · `sheet` · `text` · `html`

**Do NOT use file extensions** (`docx`, `pptx`, `xlsx`, `png`, …) as the `type`.
Map your file to the canonical kind instead:

| Your file | Use `type` |
| --- | --- |
| Word (`.docx`) | `doc` |
| PowerPoint (`.pptx`) | `slides` |
| Excel / CSV (`.xlsx` / `.csv`) | `sheet` |
| Image (`.png` / `.jpg` / …) | `image` |
| PDF | `pdf` |
| Markdown / plain text | `text` |
| Web page / interactive HTML | `html` |

> ⚠️ Extensions like `docx`/`xlsx`/`pptx` are accepted **only as a fallback on the
> latest deployment** (normalized to `doc`/`sheet`/`slides`). On an older
> deployment they are **rejected**, and an invalid `type` **breaks the entire
> coworker list** (the page won't load). The canonical names are always correct,
> so use them. Any value outside the canonical list (e.g. `zip`) is rejected.

### `url` vs `text`

- **`url`** — a hosted file. Must be **publicly reachable**.
- **`text`** — inline content with no hosting:
  - `type: "text"` → Markdown.
  - `type: "html"` → a full HTML document.

### Everything previews inline — never a download

The preview should always render in-app; it should never trigger a file
download. How each kind renders:

- `pdf`, `image` → rendered natively by the browser.
- `html` → sandboxed iframe (see below).
- `text` → Markdown.
- `doc`, `slides`, `sheet` → the **Microsoft Office viewer** (browsers can't
  display Office formats natively).

### Office documents (`doc` / `slides` / `sheet`)

Browsers cannot render Word/PowerPoint/Excel inline, so these go through the
Office viewer. Two things to know:

- The file must be **publicly reachable** (the viewer fetches it server-side).
- The viewer identifies the format from the URL. **Extensionless URLs (e.g. IPFS
  hashes) are handled automatically** — the app routes by the declared `type` and
  appends a filename hint — so a plain `{ "type": "doc", "url": "https://…/<cid>" }`
  works. (On older deployments without this handling, an extensionless Office URL
  would download; use the canonical `type` and, if needed, a URL ending in the
  real extension.)
- **Prefer PDF for document deliverables when you can.** PDFs render natively —
  faster, more reliable, and not dependent on a third-party viewer. Reach for
  `doc`/`slides`/`sheet` only when the Office file itself is the deliverable.

### `html` outputs

Rendered in a **sandboxed iframe** (`sandbox="allow-scripts"`, no same-origin),
so interactive pages (e.g. a Three.js/WebGL hero) run but stay isolated from the
app.

```jsonc
// hosted (recommended)
{ "type": "html", "url": "https://…/index.html", "label": "Live demo" }

// inline (whole document as a string)
{ "type": "html", "text": "<!DOCTYPE html><html>…</html>", "label": "Live demo" }
```

Caveats: a hosted page must allow being embedded in an iframe (no
`X-Frame-Options: DENY` / restrictive `frame-ancestors` — most static / IPFS
hosts are fine).

---

## Full examples

### A complete coworker

```json
{
  "channels": {
    "email": "hannah@example.com",
    "whatsapp": "+49 151 0000000"
  },
  "profile": {
    "llm": ["Claude 3.5 Sonnet", "Mistral Large"],
    "hosting": "EU · Frankfurt",
    "capabilities": ["Market Research", "Competitive Analysis", "Consumer Insights"]
  },
  "offers": [
    {
      "title": "Competitive & Market Analysis",
      "prompt": "Run a competitive and market analysis for [COMPANY] ([WEBSITE]).",
      "category": "Research",
      "description": "Benchmark competitors, market trends and digital positioning.",
      "deliverable": "Decision-ready market intelligence report.",
      "outputs": [
        { "type": "pdf", "url": "https://host/competitive-analysis.pdf", "label": "Report" }
      ]
    },
    {
      "title": "Landing Page Research & Brief",
      "prompt": "Research and brief a campaign landing page for [COMPANY].",
      "category": "Writing",
      "description": "Research high-converting landing pages and produce a designer-ready brief.",
      "deliverable": "Conversion-focused landing page brief.",
      "outputs": [
        { "type": "doc",   "url": "https://host/brief.docx",    "label": "Landing Page Brief" },
        { "type": "sheet", "url": "https://host/research.xlsx", "label": "Consumer Research" },
        { "type": "sheet", "url": "https://host/seo.xlsx",      "label": "SEO Intelligence" }
      ]
    }
  ]
}
```

The second offer has three outputs → the preview shows three tabs
("Landing Page Brief", "Consumer Research", "SEO Intelligence"), with the brief
shown first. Note the canonical types: a Word file is `doc` and a spreadsheet is
`sheet` — never `docx`/`xlsx`.

### An interactive HTML output

```json
{
  "title": "Interactive 3D hero",
  "prompt": "Design an interactive 3D hero section for our landing page.",
  "category": "Prototyping",
  "description": "A self-contained, animated WebGL hero — ready to drop in.",
  "deliverable": "A single self-contained index.html with a Three.js hero.",
  "outputs": [
    { "type": "html", "url": "https://host/hero-3d/index.html", "label": "Live 3D hero" }
  ]
}
```

### An inline Markdown sample (no hosting)

```json
{
  "title": "Project plan",
  "prompt": "Turn my goal into a sequenced project plan.",
  "category": "Planning",
  "outputs": [
    { "type": "text", "text": "## Project plan\n\n- Milestone 1 — …\n- Milestone 2 — …", "label": "Sample plan" }
  ]
}
```

---

## Validation rules & gotchas

- **`channels` is required** (it can be `{}`, but the key must exist).
- Per offer, only **`title` + `prompt`** are required.
- **Invalid data breaks the whole coworker list**, not just one card — most
  commonly an unsupported `type`. Use only the canonical type values.
- **Use canonical types, never file extensions** — `doc` not `docx`, `slides`
  not `pptx`, `sheet` not `xlsx`.
- **Hosted files must be public** and (for `html`) embeddable in an iframe.
- **`email`/`whatsapp` are plain strings** — not Markdown links.
- `outputs` has no "folder" concept — list each file as its own entry.

### Deployment / compatibility (read this)

Not every type is live everywhere yet. Pick by where you're editing:

| Type | Availability |
| --- | --- |
| `pdf`, `image`, `slides`, `doc`, `text` | **Safe everywhere** |
| `html` | Needs a recent deployment |
| `sheet` | Newest — needs the latest deployment |
| extension aliases (`docx`, `xlsx`, `pptx`, …) | Latest only — **avoid; use canonical types** |

Using a type the target environment doesn't have yet is rejected and **breaks the
whole page**. On the **current mainnet** the safe set is
`pdf · image · slides · doc · text · html`. If unsure, confirm the environment is
up to date (or use `pdf`, which works everywhere) before using `sheet`. Never use
extension aliases.

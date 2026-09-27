# Intelligent Files — implementation plan (Jev-only revision)

Status: active implementation plan for branch `codepat/intelligent-files-01a0df94`.

This plan is the build-order translation of the reviewed design. It supersedes the
provider selection, the EU-specific requirements and the planning-only restriction in
the research deliverables. Everything else in those deliverables — the F1–F9 review
corrections, the product/interaction specification and the state contract — stays in
force and is the acceptance baseline for this branch.

Source of record for the design: `FILES-PLAN-FINAL.md` and
`10-JEV-ONLY-IMPLEMENTATION.md` in the research workspace
(`sokosumi-files-plan-01a0df94/deliverables/`). The historical research is preserved
there unchanged; nothing in this document rewrites those findings.

## 1. Provider decision

**Jev (`typesafe-ai/jev`) through the existing Vercel AI Gateway integration is the
sole AI model** for Files relevance evaluation, related-document ranking and
taxonomy/project suggestions.

Removed from scope on this branch:

- EU-specific routing and `inferenceRegion` pinning as a launch gate.
- EU self-hosted ranker and embedding deployment (BGE-M3 / BGE-reranker).
- ZDR eligibility as a launch gate.
- Any alternative AI provider or second model as a fallback.
- A provider or region selector in the UI.

Retained, because they are not provider properties:

- Stable file identity, server-side extraction, an authorized retrieval index.
- Deterministic exact-filename protection ahead of any model ordering.
- Bounded, token-accounted evaluation input and per-request authorization admission.
- Stable, snapshot-based pagination.
- Honest quality/latency reporting, and explicit candidate-recall measurement.

**Jev evaluates supplied text.** It is not a document store, an extractor, an
embedding model or a search index. Candidates come from lexical and metadata
retrieval over the authorized SQL relation; Jev only reorders a bounded shortlist and
answers bounded typed questions about a bounded excerpt. When Jev is unavailable,
disabled, over budget or returns anything invalid, the deterministic
filename + full-text ordering is the result. That fallback is the absence of a model,
not a second provider.

### Retention: corrected against what main ships

An earlier revision of this section treated the public catalog as the last word:
Jev has no `regions` field, `has_zdr=false`, `no_training=all`, therefore zero
retention is unavailable. **Main's shipped task-tag classifier contradicts that**,
and it is the working integration. It sends
`providerOptions.gateway.{zeroDataRetention: true, disallowPromptTraining: true}`
on every evaluation, and its own comment records why: *the public catalog omits the
TypeSafe ZDR route, so its aggregate retention flags must not be used to reject a
route the Gateway can enforce per request*. It ships enabled by default over task
titles and descriptions.

So the catalog flags are **not** authoritative about what the Gateway will enforce,
and this plan no longer says they are. What replaces that claim, precisely:

- Files asks for the same two retention options on **every** call, and a call is
  never retried without them. If the Gateway rejects a request carrying them, the
  evaluator latches off for the life of the process rather than downgrading
  (`jev-client.ts`, `provider-options-rejected`).
- **Retention is requested, not verified.** Nothing in a successful reply attests
  that either option was honoured, so no surface, log or document on this branch
  describes Files as ZDR-verified. Upstream flags are not treated as proof either
  way — that cuts in both directions.
- The availability probe checks only that the model id exists in the catalog. It
  deliberately ignores the catalog's retention flags, for the reason above.

`FILES_JEV_ENABLED` still defaults to **false**, unlike the task-tag feature's
default-on flag. That is a scope judgement rather than a retention claim: task tags
send a title and a description, Files would send document body text, which is a
larger surface to turn on without a human saying so. Flipping the default is a
one-line change once someone decides to.

An earlier version of this document also justified the default on the grounds that
reported usage had been reconciled against the serialized-input ceilings. **That
was not true**, and not only because the reconciliation needs live calls we are not
authorized to make: the ceiling it named excluded most of the request, so there was
nothing meaningful to reconcile against. The ceiling now covers the whole request
(see §7), which makes that reconciliation possible to do later — it still has not
been done.

This branch adds no EU routing and no ZDR claim to any surface. An independently
configured workspace restriction that already blocks external inference is still
honoured — dropping the EU requirement from *this feature* does not authorise
bypassing an existing restriction.

### The request contract

Files uses main's verified shape, not the guess this plan originally carried:
`state` is an object, `questions` is a map of `{id: {type, instructions}}`, and the
reply is `{model, answers, usage, providerMetadata}`, Zod-validated. Only
`type: "boolean"` is demonstrated by the shipped integration, so the 0–3 relevance
rubric is asked as a ladder of boolean rungs and the ordinal is derived from the
highest true rung. `type: "choice"` stays unused until it is confirmed against the
official contract.

No paid live inference is authorised. Every model test on this branch uses mocked or
synthetic fixtures, and no result from those tests may be described as a live Jev
benchmark.

## 2. What exists today

| Surface | Today | Gap this plan closes |
| --- | --- | --- |
| `/drive` Browse/Recents | Vercel Blob listing by pathname, page-local or drained sort, prefix-only `q` | No durable identity, no metadata, no content search |
| Drive upload | `POST /v1/drive/files` mints a Blob grant; bytes go client → Blob | Nothing records that the upload happened, so nothing can index it |
| Task deliverables | `GET /v1/drive/tasks` lists task outputs | Not part of one searchable surface |
| Global search | `history-search-dialog.tsx` over the history corpus | No Files group, no deep links into a file |
| AI | `ai` 7.0.114 + AI Gateway (`AI_GATEWAY_API_KEY`), used by Soko Bot classifier/judge | No evaluation adapter; chat streaming interface is the wrong shape for Jev |
| Background work | Vercel crons under `/sync/*`, **which do not run on previews** | Indexing must also run in-process so a preview can be demonstrated |

Moving contracts to re-check before integrating: **#4747** (native Tables in Files),
**#5256** (image studio v2), **#5258** (task tags), **#5260** (unified collections).
This branch must not take ownership of their surfaces.

## 3. Build order

Each increment is a reviewable commit that leaves the branch coherent.

1. **Catalog schema.** Prisma models and one migration: resources, versions, chunks,
   evidence scopes, vocabulary, labels, project links, field overrides, lineage,
   collections, index jobs, artifact registry, admissions.
2. **Catalog admission.** Upload finalize, task-output adoption, tombstones, revision
   bookkeeping, per-source authorization adapters.
3. **Extraction and index.** Bounded extraction for the formats the runtime can do
   safely, chunking with anchors, Postgres FTS (`tsvector`) plus normalized filename
   exact/prefix indexes, job runner on cron **and** in-process for previews.
4. **Retrieval.** Authorized SQL relation, candidate budgets, RRF fusion, exact-match
   protection, ranked-window sessions and cursors.
5. **Jev evaluation adapter.** Token-ceiling serializer, per-request admission,
   scheduler quotas, circuit breaker, all-or-nothing reorder.
6. **Taxonomy and suggestions.** Workspace vocabulary, suggestion runs, persistent
   manual corrections and negative overrides, confirmed project links.
7. **Files API.** Search, resource, related, metadata patch, batch, suggestion
   decision, reindex, labels, collections.
8. **Files UI.** All-files tab, filters, list/grid, bulk editing, collections, detail
   route with related documents, mobile sheets.
9. **Global search.** Files group in the Cmd/K dialog and the mobile search route,
   with keyboard semantics, safe snippets and deep links.

## 4. Data model

Core-owned, all under `@sokosumi/database`. Immutable IDs, explicit provenance, and
revisions that are separate from authorization epochs.

- `FileResource` — `(workspaceKind, workspaceId, sourceKind, sourceScope, sourceId)`
  unique; display and normalized name; `contentRevision`, `metadataRevision`,
  `aclRevision`; lifecycle with tombstone.
- `FileVersion` — `(resourceId, revision)` unique; immutable object identity, hash,
  size, MIME; extraction state and coverage; `textRevision`; extractor version;
  `indexGeneration`.
- `FileChunk` — `(versionId, chunkId)`; ordinal and anchors; normalized text;
  `evidenceScopeId`, `scopeVersion`, `inputDigest`. A chunk never mixes audiences.
- `FileEvidenceScope` — canonical policy reference plus revision and actor-kind
  eligibility. It is a predicate, never a model-supplied user list.
- `WorkspaceLabel` — `TAG` or `CATEGORY`, normalized/display name, description,
  aliases, archive flag, `vocabularyVersion`.
- `FileLabel`, `FileProjectLink` — state, provenance (`MANUAL`/`MODEL`/`RULE`),
  evidence scope and digest, the versions the decision was made against, evidence
  anchors, decision actor and time.
- `FileFieldOverride` — versioned pin/reject/allow per field or label and evidence
  audience. This is what makes a manual correction survive reindexing.
- `FileLineage` — `(workspaceId, sourceKind, sourceScope, rootId)` group with a
  representative policy, for Studio version families.
- `FileCollection` — owner, workspace, private-or-shared, versioned filter definition
  and sort. Never a stored result set, never a stored count.
- `FileIndexJob` — dedupe key over
  `(resource, contentRevision, pipeline, requiredScope, desiredGeneration, operation)`,
  attempt, fence, lease, budget, retry state.
- `FileIndexArtifact` — every scratch/object/vector artifact registered **before** a
  sensitive write, with an active/abandoned/purged state.
- `FileAuthorizationAdmission` — request id, actor fingerprint, epochs, payload
  digest, provider, admission and dispatch outcome. No raw content, ever.

## 5. Authorization model

The invariant: every title, tag, snippet, category, project name, related edge and
cached score requires valid source and evidence-scoped admission for its recipient.
No field is authorized by the index alone.

- Source × actor gates stay exactly as they are today. The catalog is a ceiling, not
  a grant. Unimplemented combinations fail closed.
- Studio assets are interactive-user-only in v1 and expose **no** derived fields to
  any other actor kind.
- Native Tables content indexing stays disabled until a canonical column-read
  contract exists; metadata-only integration may proceed under the existing gate.
- Content-derived metadata inherits the **intersection** of contributing evidence
  scopes. Manual confirmation is not declassification.
- Labels and project links never change access. Confirming a project suggestion says
  so in the UI and does not mutate any ACL.
- Every outbound Jev pair request takes its own one-use admission under scope-epoch
  row locks, expiring after 50 ms if dispatch has not started. The guarantee is
  *authorized admission*, explicitly weaker than "no socket send after revocation
  commits", and the code and docs say so.
- Deletion or any policy epoch change advances the epoch, rejects ranked-session
  cursors and requires a restart. Content-only changes use revisions and cause the
  stale entry to be omitted from the snapshot window.

## 6. Retrieval and ranking

Candidate budgets: exact filename ≤20, FTS ≤100 chunks, metadata ≤40 resources,
union/dedup ≤120 resource/lineage results. No vector stage on this branch — the
embedding model was removed with the EU deployment and Jev is not an embedding model,
so semantic quality comes from Jev evaluation over lexical/metadata candidates.
**Candidate recall is therefore the measured risk**, and the evaluation harness
reports recall@120 for the synthetic set explicitly rather than assuming it.

Fusion is RRF (k=60, a tuning default). Protected exact normalized filename matches
always precede everything else and are labelled "Filename match". Explicit date/name
sorts are never reranked. Postgres FTS ranking is called FTS, not BM25.

Ranked windows: a ≤5 min server-side session stores a fixed order of resource IDs
with pinned revisions, the query/filter/sort, and the scope epoch vector. The cursor
is a signed opaque session id plus the **next unconsumed snapshot position**. A page
advances over every scanned position, omits entries whose revisions changed, and
never substitutes a new version into an old position. `truncated` and `hasMore` are
independent; `hasMore` means unconsumed positions, not additional corpus matches.

## 7. Jev adapter

- Transport: AI Gateway, model id `typesafe-ai/jev`, evaluation shape (typed
  questions over supplied state) — not the chat streaming interface, and not
  `@sokosumi/ai-provider`, which is the chat provider and stays untouched.
- Budget unit is tokens in the **entire request sent to the Gateway** — the state,
  and the envelope the transport wraps around it. Ceilings: search pair 1,700,
  related pair 2,800, label/category/project evaluation 4,400. Fields are bounded,
  truncated at safe boundaries, re-serialized and re-measured; JSON is never
  chopped. If the request still exceeds the ceiling, it is rejected, not sent.
- **Corrected figures.** The ceilings above were 1,024 / 2,048 / 4,096 when the
  rubric and the question lived in the measured body. Once the ladder moved into
  the transport's question map, the measurement kept counting only the state and
  added a flat 64 for "framing", which under-counted **every** call:

  | Call | Envelope, measured | Old allowance | Under-count |
  | --- | --- | --- | --- |
  | Search or related pair (`relevance`, three rungs) | 750 | 64 | **686** |
  | Label evaluation (`belongs`, two rungs) | 603 | 64 | **539** |

  `rubricEnvelopeTokens` now serializes the real envelope and counts it, so the
  figure follows the rubrics when one is reworded. The totals rose by roughly the
  under-count so the **content** budgets are unchanged: a search pair still gets
  128 tokens of query and 640 of candidate.

  For re-deriving cost: a search rerank is up to 24 pair calls, each now bounded at
  1,700 tokens of input rather than 1,024 — so the worst-case input for one
  reranked search is about **40,800 tokens**, not 24,576. A label pass is one call
  per candidate label at 4,400.
- Scheduler: global token buckets (3,600 req/min, 60 req/s, burst 12, 24 concurrent),
  ≤6 per query, per-workspace ≤30 req/s. Interactive work reserves 80 %; background
  labelling takes ≤20 % and never borrows interactive capacity.
- Results: all-or-nothing reorder. Any missing, invalid, out-of-range or timed-out
  pair returns the full original fused order. Partial scores never mix scales.
- Circuit breaker: ≥50 % failed batches in 20 requests over 60 s opens it; probe
  after 60 s.
- Failure is silent to the user in ranking terms: the same search field, the
  deterministic order, no provider jargon, no dead end.
- No document text, query text or secret ever reaches a log line.

## 8. Product behaviour delivered

Requested tags/categories/vocabulary; suggestions with an evidence "Why?"; manual
corrections that persist across reindexing through `FileFieldOverride`; explicitly
confirmed project links that state they change no access; upload and background
processing states; filters, list/grid, saved collections and bounded bulk editing;
document detail with metadata, **an in-place preview** and related documents; Files
in global search with
escaped snippets, keyboard semantics and deep links; mobile sheets and full-screen
detail. The state contract table in the product specification is the acceptance list
for empty, loading, partial, failed, revoked, conflict, offline and deleted states.

### The content proxy

The detail preview reads bytes through `GET /v1/drive/resources/{id}/content`,
authorized per request by the same `buildAuthorizedResourceSql` gate as every other
Files read, and proxied same-origin by `/api/drive/files/{id}/content` so the browser
never needs a Core credential. `FileVersion.objectKey` stays server-side, which is
what keeps the detail shell free of URL data: a reader never acquires a storage link
that outlives their access.

What it does **not** do, stated plainly: Drive objects live in a *public-access* Blob
store, so anyone who already holds a storage URL can still fetch it without passing
this route. The proxy stops the product handing those URLs out; it does not revoke
ones already held. Closing that would mean moving the drive store to private access
and migrating every existing object, which is not this branch.

Two rules make it safe to serve reader-supplied bytes from our own origin:
`content-disposition` is `inline` only for a small allowlist (plain text, Markdown,
CSV, JSON, PDF, PNG/JPEG/GIF/WebP) and `attachment` for everything else, so a stored
`.html` or `.svg` cannot execute as a same-origin document; and every response carries
`X-Content-Type-Options: nosniff` plus `Content-Security-Policy: sandbox; default-src
'none'`. Filenames are stripped of quotes, backslashes and control characters before
they reach the header, with the real name carried in `filename*`.

### Extraction: what is read, and what is honestly not

Word, PowerPoint and Excel (`.docx`, `.pptx`, `.xlsx`) are read. An OOXML file
is a ZIP of XML parts, so `lib/files/ooxml.ts` unzips the parts that carry
prose and strips their tags. `jszip` does the unzipping — chosen because it is
**already in this repository's lockfile**, pulled in by the `docx` package the
web app uses to write documents, so Core gains a direct dependency on code
that was already installed rather than new code in the tree. No XML parser is
used: the tag stripper is a character scan, which means no entity expansion,
no DTD, no external-entity fetch, and none of the XXE surface a parser brings.

Bounds, because extraction reads reader-supplied bytes: only named parts are
opened, a part is refused if its *declared* uncompressed size exceeds 8 MB —
before it is inflated, which is what stops a zip bomb — the running total is
capped at 1M characters, enumerated slides and sheets are capped at 200, and
anything that throws resolves to `UNSUPPORTED` with a reason rather than
failing the job. A 9 KB archive declaring 9 MB of content is refused without
expansion; there is a test.

**PDF is not read, and that is a decision.** Nothing in the repository can
parse one, and every credible option is a large new dependency interpreting
adversarial bytes in the same process as the API. A half-working reader is
worse than none: a PDF silently indexed as empty looks searched and is not.
PDFs stay `UNSUPPORTED` with the reason "PDF text is not read in this version.
The file is findable by name and can be downloaded." Doing it properly means
the sandboxed parser this document has always promised — a separate process
with its own memory and time limits — which is a bigger change than an import.

No OCR, so an image-only or scanned PDF is covered by the same honest state.
Legacy binary Office (`.doc`, `.ppt`, `.xls`) is out for the same reason as
PDF.

Extracted Office text goes through the same budgets as text files, verified
rather than assumed: a 40,000-paragraph document comes back `PARTIAL` with a
reason and a coverage below 1, and the Jev label request built from its first
chunks stays inside `LABEL_EVALUATION_CEILINGS.total` — which now counts the
transport envelope as well.

## 9. Verification

- Unit tests for the serializer and token ceilings, the fusion and exact-match
  protection, the cursor/window semantics, the override persistence rules, the
  scheduler and circuit breaker, and the evidence-scope suppression rules.
- Integration tests against a disposable Postgres with all migrations applied, opt-in
  through `RUN_DATABASE_INTEGRATION_TESTS`, as the existing `*.postgres.test.ts`
  suites do.
- Jev is always mocked. A synthetic relevance fixture measures ordering behaviour and
  candidate recall; it is labelled synthetic everywhere it appears.
- `pnpm check`, `pnpm typecheck`, and the affected package test suites.
- UI verification on a preprod preview with the designated test account through
  chrome-devtools. No local Sokosumi dev server or build.

## 10. Out of scope on this branch

Exhaustive "select all matches", vector/ANN retrieval, OCR, legacy DOC/PPT/XLS
conversion, Tables content indexing, a metadata declassification operation, generative
summaries, and any merge or production deployment. Anything in the accepted scope that
is not finished stays explicit remaining work on this task; it is not quietly dropped.

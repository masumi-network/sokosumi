# Native Tables Implementation Plan

**Goal:** Implement the approved Native Tables design in Files, including human and agent editing, without templates.

**Architecture:** Core owns fixed PostgreSQL models and validated JSONB values. Files presents live table resources. Existing workspace authorization, generated Core client, Soko Bot capability dispatch, and task integration remain the boundaries.

**Execution:** Inline in the assigned CodePat worktree. No additional workers. Independent Claude and CodeRabbit reviews are coordinated after a reviewable draft PR exists.

## Constraints

No templates, top-level navigation, formulas, relationships, attachment columns, schedules, external sending, deployment, merge, or production data. Stable IDs, bounded requests, atomic mutations and history, retry safety, visible conflicts, and scoped agent writes are required.

## Tasks

- [x] Inspect setup, current main and open PRs. Install pinned dependencies and bootstrap isolated environment.
- [x] Add DataTable, TableColumn, TableRow, TableView, TableChange and persistent operation/scope records. Generate migration against isolated PostgreSQL; verify persistence and additive compatibility.
- [x] Implement typed validation and Core operations: create/list/read/query, column metadata/order, row batches, archive/restore, views, history and conflict-safe undo. Every mutation uses durable idempotency and atomic history. Add security and concurrency tests.
- [x] Integrate Soko Bot tools and coworker task scope. Publish live references immediately. Selected-row assignments persist exact allowed rows/columns. Test retries and denied access.
- [x] Regenerate Core client. Extend existing Files surfaces with Tables filter and blank/CSV creation. Build bounded editable grid, views, CSV preview/mapping/export, cell history and batch undo using existing UI primitives.
- [x] Test actual local database and browser flows, light/dark/mobile and keyboard editing. Record performance limits and missing prerequisites honestly. See the 2026-09-23 recovery verification in `docs/native-tables.md`.
- [ ] Review diff, run repository checks, commit, push and create/reuse draft PR. Report exact evidence and outstanding independent reviews through CodePat.

## Reuse decisions

- `drive-file-access.ts` and workspace context supply ownership/membership conventions; tables need their own live-resource model rather than blob storage.
- `serializableTransaction` supplies PostgreSQL retry behavior for atomic idempotent mutations.
- Existing `soko-bot-runtime.service.ts` capability dispatch is the usable agent entry point; table operations must be callable there, not merely exposed as REST.
- Existing Drive cards, dialogs, controls, React Query and generated Core SDK supply the web presentation and transport.

## Migration and rollback

The migration adds fixed tables and relations only. Existing application versions continue to run. Application rollback leaves the new data intact; no destructive down migration is executed. Verification uses an empty, worktree-owned PostgreSQL cluster.

## Supplied design reference

The attached utxo AG DESIGN.md was read on resume. Apply its restrained hierarchy, purposeful spacing, clear controls and lack of decorative effects. Sokosumi's existing Inter typography, semantic tokens, component density and dark/light themes remain authoritative; do not import the reference's marketing fonts, raw hex values or oversized headings.

## Verification prerequisite

The original HTTPS/authentication blocker was resolved on 2026-09-23 using a task-owned network namespace, HTTPS port 443 and a separate synthetic fixture database. Authenticated browser acceptance passed without changing shared Caddy. Live model/provider acceptance remains unverified; see `docs/native-tables.md` for exact coverage and limitations. The PR remains draft and must not be merged.

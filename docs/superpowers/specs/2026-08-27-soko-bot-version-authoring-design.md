# Soko Bot Version Authoring Design

**Status:** Approved on 2026-08-27

## Goal

Give platform admins one place to inspect every Soko Bot version, create an authored version from scratch or by duplicating an existing version, test it in the Behaviour Lab, and promote it as the default for newly created bots.

## Product boundaries

- Built-in versions remain code-owned and read-only. Their detail view explains this and offers duplication instead of editing.
- Authored versions can be edited and archived.
- Promotion changes the version assigned to new bots only. Existing bots stay pinned to the version they received at creation.
- Version detail reports real-run quality separately from Behaviour Lab history.
- Web reads and mutates version data only through the generated Core client wrapper and Web service/action layers.

## Information architecture

The version workflow uses dedicated routes so the system prompt has enough space and every version has a shareable URL:

- `/admin/soko-bots/versions` lists all active versions.
- `/admin/soko-bots/versions/new?from=<slug>` creates a version. When `from` is present, every editable field is copied from that version and the new slug stays blank.
- `/admin/soko-bots/versions/[slug]` shows the full version, its real-run metrics, and lab history.
- `/admin/soko-bots/versions/[slug]?mode=edit` edits an authored version.
- `/admin/soko-bots/lab?version=<slug>` opens the existing lab with that version selected.

URL search state is parsed and synchronized with `nuqs`.

## Versions list

The list shows the version name, slug, model, inference region, and state. Badges identify the current default and distinguish built-in versions from authored versions.

Every row links to the detail view. Built-ins offer Duplicate instead of Edit. Authored versions offer Edit and Duplicate. Promote and Archive are available from the detail view, where their consequences have enough context.

## Create and edit form

The form contains:

- slug, editable only during creation;
- name and summary;
- a large, full-width system prompt editor as the dominant field;
- a free-text model field with an optional searchable gateway-model picker;
- gateway model choices showing model name, id, and reported regions;
- a shadcn inference-region selector with none, EU, and US options;
- checkbox-based multi-selects for available skills and tools.

An empty gateway model response leaves the model field fully usable. An empty tools selection is described as “Every tool allowed by the route” and is never presented as “No tools.”

Duplicating any version copies its name, summary, prompt, model, region, skills, and tools. The slug is deliberately blank. The form identifies the source version so the admin understands that saving creates a separate authored version.

## Version detail

The detail view presents the version’s default state, ownership type, model, region, skills, tools, full prompt, real-run turn count, judged count, average score, and the signed-in admin’s recent lab history for that version.

Built-ins use a visible read-only notice explaining that code owns them and duplication is the path to customization. Authored versions expose Edit. Every non-default version can be promoted. Authored non-default versions can be archived; Core also rejects attempts to archive the current default. Because archived authored versions are no longer resolvable, bots pinned to one fall back to the built-in default on their next run.

The lab link carries the version slug in URL state. The existing Behaviour Lab remains the place where scenarios are run and judged.

## Mutation behavior

Web server actions validate inputs, require an admin session, call the admin Soko Bot service, map Core errors to the standard action result, and revalidate the versions list, version detail, admin overview, and lab where relevant. Core registers static version endpoints before the dynamic bot-id endpoints so `/versions` cannot be parsed as a bot UUID.

When a specific version has no real turns in the quality window, Core returns zero real-run metrics for that version instead of falling back to fleet-wide values.

Promotion requires confirmation with this meaning stated plainly: the change affects new bots only, while existing bots keep the version they were created on. Archive also requires confirmation.

## Visual direction and accessibility

The UI follows the existing admin console’s precise, compact style: semantic neutral surfaces, borders for grouping, and existing status colors only. The prompt remains readable in a wrapping monospace block. All controls use labels, keyboard-accessible shadcn primitives, visible focus states, and translated copy.

## Localization and verification

All new product copy is added to `apps/web/messages/en.json`, `de.json`, and `es.json`. Tests cover service/action payloads, duplicate-prefill behavior, built-in read-only presentation, default state, empty-tools meaning, promotion confirmation, and lab version URL state.

Before the local commit, run under Node 24 with `ulimit -n 65536`:

- `pnpm typecheck`
- `pnpm exec biome check .`
- `pnpm --filter web test`
- `pnpm --filter core test`

Do not push or deploy.

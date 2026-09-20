# Agent context budget

Root `AGENTS.md` is the startup contract and mandatory loading guide. Detailed
instructions remain in task-specific documents. Preserve those loading triggers
when changing this layout; a link without a trigger does not ensure an agent reads
required context.

## Requirement locations

The September 2026 split preserved the original section bodies, adjusting relative
Markdown links and one reference to the owning instruction file. Title, purpose,
and progress reporting were rewritten in the root contract.

| Original root sections | Canonical location |
| --- | --- |
| Tech Stack & Architecture; Code Changes; Generated Files; Shared Packages and Deduplication; Database Access | [Architecture](architecture.md) |
| TypeScript Usage; Naming & Patterns; Code Style; Linting & Formatting; Testing Guidelines; Code References; Additional Rules | [Code conventions](coding-conventions.md) |
| UI & Styling; Key Conventions | [Web UI](web-ui.md) |
| Environment & Tooling except Git hooks; Commands; Running & known local gotchas | [Local development](local-development.md) |
| Git hooks; Commit & Pull Request Guidelines | [Delivery](delivery.md) |
| Agent skills, including domain references | [Skill and domain routing](skill-routing.md) |
| Cursor Cloud instructions except Running & known local gotchas | [Cloud environment](cloud-environment.md) |
| Purpose, scope discovery, Status Updates, universal guardrails | [Root contract](../../AGENTS.md) |

The initial split kept app/package instructions, skills, and `.cursor/rules/` in place.
The skill relocation in the follow-up below is a separate, subsequent change.
Web's incoming link to the old root lint section now points to code conventions.

## Measurements

Measured on 2026-09-20 using Codex CLI 0.155.1 and the `o200k_base` tokenizer.
These are reproducible content counts, not a claim about the desktop app's total
model input or its exact tokenizer.

| Surface | Before | After instruction split |
| --- | ---: | ---: |
| Root file, bytes | 36,754 | 4,804 |
| Root file, tokenizer tokens | 9,354 | 1,047 |
| Fresh CLI prompt text, tokenizer tokens | 16,249 | 8,970 |

The root file shrank 87% by bytes. The fresh CLI prompt text shrank 45%. The CLI
prompt measurement excludes tool schemas and message framing, and does not include
desktop-specific injected instructions. Do not subtract these counts directly from
the desktop's reported startup usage. Task-specific documents will add context
when their triggers fire.

Use `codex debug prompt-input 'Reply only OK.'` from the same checkout to render a
fresh prompt without running a model task. Count only text blocks with the same
tokenizer for comparable measurements. Keep raw prompt output outside the repository.
A fresh desktop task in the changed checkout is still needed to measure the
complete desktop startup cost; an existing conversation retains its prior history.

A subsequent CLI `/status` screenshot, after the first `Reply only OK.` response,
reported **24.9K context tokens used / 258K**. This is the observed runtime figure,
not the narrower prompt-text count above. A subsequent screenshot of the primary
checkout on `main`, using Codex CLI 0.155.1, the same model/reasoning setting, and
the same first prompt, reports **32.2K context tokens used / 258K**. The observed
difference is approximately **7.3K tokens (23%)**. These are rounded UI readings
from separate checkouts, not a fully controlled benchmark; the main screenshot
also reports failed local hooks. The earlier ~60K estimate is not this baseline.

## Skill duplication

The local audit found 44 repository skill names with plugin counterparts. Many
have different content; matching names alone are insufficient grounds for deletion.
The repository copies also support other agent tools and must not depend on a
particular user's installed Codex plugins.

One full skill directory, `debugging-with-ably-cli`, was identical in user scope,
the primary checkout, and this worktree. A backed-up local Codex configuration
suppresses the two repository registrations while retaining the user registration.
No skill files or plugins were removed. A fresh prompt confirmed one remaining
registration and 8,962 tokens of CLI prompt text (7,287 fewer than baseline).
That machine-local configuration is not a repository requirement and does not apply to other developers or future worktrees.

Codex supports disabling individual registrations without deleting skill files;
see the [official skill configuration documentation](https://learn.chatgpt.com/docs/build-skills#enable-or-disable-local-codex-skills).
Only suppress a registration after verifying that its replacement is available
in the same host and that its supporting files match. Recheck after skill updates.

## Verification

- Compare moved section bodies against the previous root document; account for
  every removed line, allowing only link rebasing and the documented root rewrites.
- Resolve local Markdown targets and heading anchors in the contract and moved docs.
- Run `node --test scripts/ci/__tests__/doc-script-references.test.mjs` to validate
  documented pnpm commands against the workspace manifests.
- Run `pnpm format` and `git diff --check`, then review the final diff.

## Follow-up: scope Web UI skills

Eleven Jakub UI skills moved from root `.agents/skills/` into
`apps/web/.agents/skills/`, matching the existing Web skill installation layout.
Their 57 files are byte-for-byte unchanged. Their eleven lock entries moved into
`apps/web/skills-lock.json`, and the corresponding Claude symlinks moved into
`apps/web/.claude/skills/`. No duplicate root links remain.

The root contract now resolves app skills before shared skills. Web's existing
mandatory UI-skill list points to the new paths and explicitly requires reading
them even when a session started at root does not list them. Shared engineering,
API, browser automation, and debugging skills remain at root because their scope
crosses apps. User-installed plugin versions remain unchanged: similarly named
skills can carry different instructions, and repository operation must not depend
on a user's plugins.

Fresh CLI prompt renders with the same `Reply only OK.` input gave:

| Discovery surface | Before scope change | After scope change |
| --- | ---: | ---: |
| Root catalog entries | 114 | 107 |
| Root automatically discoverable Jakub UI skills | 7 | 0 |
| Root prompt-text tokens (`o200k_base`) | 8,962 | 8,938 |

A render from `apps/web` still lists all seven automatically invoked UI skills.
The other four retain their original explicit-invocation policy and remain linked
from Web instructions. Codex uses the catalog space for remaining descriptions,
so this move saves only 24 prompt-text tokens. It improves scope relevance rather
than establishing a large additional token saving. It does not change models,
reasoning effort, tool permissions, or skill content.

Structural routing checks:

| Representative task | Required route preserved |
| --- | --- |
| Web UI change from a root-started session | Root UI trigger → Web `AGENTS.md` → all eleven app-scoped UI skill paths |
| Core API change | Root architecture/code conventions → Core `AGENTS.md`; UI skills absent from root discovery |
| Native SwiftUI change | Root Apple scope → Apple instructions and its existing SwiftUI skill |
| Instruction edit | Root writing-for-agents pointer → unchanged shared skill |

Verification compares every relocated file against its Git source, checks unchanged
lock metadata and resolving Claude symlinks, renders both root and Web catalogs,
and checks document links. These are preservation and discoverability checks, not
a benchmark proving unchanged model reasoning or task success rates.


## Skill-manager verification

After the initial manual relocation, all eleven UI skills were reinstalled with
`npx skills add jakubkrehel/skills` from `apps/web`, explicitly selecting the eleven
names and the Codex/Claude Code agents. The CLI reported every skill installed;
`npx skills list --json` recognized every skill and its GitHub source. All eleven
CLI-produced hashes matched `apps/web/skills-lock.json`. Reinstallation produced
no skill-file or lockfile diff. Future installation and scope changes must use the
CLI, as documented in [Skill management](skill-routing.md#manage-installations-with-the-skills-cli).

## Follow-up: remove root CLAUDE.md

Root `CLAUDE.md` held an `@AGENTS.md` import plus a copy of the PR-title and branch
rules. Claude Code v2.1.277 and later reads root `AGENTS.md` directly when no
`CLAUDE.md` exists in the working directory or above it, so the file was removed;
the rules remain in the root contract and [Delivery](delivery.md). This saves about
400 tokens per Claude Code session. Sessions that cannot read `AGENTS.md` directly
(older versions, third-party providers, disabled telemetry) need a local
`CLAUDE.md` containing `@AGENTS.md`.

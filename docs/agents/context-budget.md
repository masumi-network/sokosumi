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

Existing app/package instructions, skills, and `.cursor/rules/` remain in place.
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
not the narrower prompt-text count above. No equivalent pre-change runtime
measurement was captured, so a runtime reduction percentage is not established.

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

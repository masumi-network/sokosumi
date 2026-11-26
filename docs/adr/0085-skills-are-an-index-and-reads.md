# Skills are an index and reads; system prompt and tools stay the same across turns

Status: accepted for cmo-v24 (2026-11-25); the next Soko Bot version takes the same switch.

## Context

`composeSystemPrompt` pasted every version skill in full into the system prompt of every turn. cmo-v23 has 18 skills, about 131 KB (33k tokens). The strategy skill (50 KB) and the Brand Brain skill (22 KB) went into every chat turn and every "thanks". The only filter was `cmoTurnSkills`, which dropped five skills on production turns. Soko Bot versions use the same composer, so they carried every skill too: 30 KB on v36.

The writing skills already worked the way a harness should: a short list in the context, `read_writing_skill` on demand, and the run's own skills in the production brief.

## Decision

A version sets `skillsOnDemand: true`. Its turns then get:

- **An index, not the skill bodies.** The system prompt lists each skill by id, name and one "use when …" line (`SKILL_INDEX` in `packages/soko-bot/src/versions/skill-index.ts`). The skill texts themselves are unchanged.
- **Loading on demand.** One tool, `read_skill(id)`, returns a version skill in full. For Cuso it also returns a writing skill, so it replaces `read_writing_skill` on these versions. The prompt maps the old name for briefs and skills that still say it. A read stays in the turn's messages for the rest of the turn.
- **Preloads by the kind of turn.** Core already knows what a turn is before the model starts: the organizer's kind for Cuso, and Jev's route plus the turn's source for Soko Bot (`skillOccasions` in `soko-bot-runtime/context.ts`). Each index entry lists the occasions that always need it in full:
  - strategy: strategy, Brand Brain, industry
  - production: production, month points (the run's writing skills are in its brief)
  - daily: daily watch
  - weekly: measurement, SEO reports
  - brand refresh and onboarding: Brand Brain, site pages (and industry for onboarding)
  - SEO and competitor turns: their own skill
  - chat and events: none
  - Soko Bot: by route (Tasks, Coworkers and Agents, hand-offs), by source (mail, schedules), and result cards on every turn
  - every turn: the two skills that explain the turn's own context and tools
- **A record.** Each turn logs `skills.preloaded` (its occasions and preloaded ids). Reads are ordinary `read_skill` tool calls.

### The prompt cache

The harness audit (2026-11-25) found that the first model call of a turn almost never hit the provider's prompt cache: 0–6% against 92–97% on later steps. The packet, persona and MCP list sat in the system string, and OpenAI caches system and tools as one prefix, so one changed byte meant no cache. On these versions:

- **The system string** is the identity, the version prompt, the every-turn skills, the skill index and fixed guidance. It is the same on every turn of the version and the same for every bot.
- **The first user message** opens with what changes from turn to turn:
  - the skills this kind of turn preloads (first, because they are stable per kind)
  - the persona
  - the MCP servers
  - the packet
  - the latest exchange and the reply language
  - then the turn's own message

  Turn parts get the same preamble.
- **One fixed tool set per version** (`stableCapabilities`): every tool the version can use, on every turn a person or a schedule starts. Only a turn another assistant asked for, and meeting prep, keep their own fixed sets. The route still decides at execution: a tool the grant leaves out is refused in words the model can act on. Announcements and Exa stay with the bots and keys that have them.
- **`promptCacheKey`** is the version id plus a hash of system and tools, so equal prefixes share a key. **`promptCacheRetention: "24h"`** is set because 61% of first calls come more than 30 minutes after the bot's previous call. OpenAI documents all prompt caching, 24h included, as compatible with Zero Data Retention: it stores encrypted KV tensors in GPU-local storage, at most 24 hours. Both runtimes set it; the sandbox proxy lets only a well-formed key through and sets the retention itself.

A version without the flag composes exactly as before.

## Consequences

- Chat and event turns carry about 21 KB of prompt instead of 147 KB. A strategy turn still carries about 94 KB, because it needs those skills.
- A turn can miss a skill it needed. Evals catch that: a strategy question in chat must read the strategy skill, a "thanks" reads nothing, and the daily run must carry the daily-watch skill. The rest of the suite shows whether the "use when" lines are good enough to choose by.
- A new skill needs an index entry. A test fails for any skill of a current or on-demand version that has none.

## Considered

- **Keep `read_writing_skill` and add a parallel reader:** two tools for one job. `read_skill` is the general one; older versions keep the old tool.
- **Let Jev pick skills on chat turns:** a cheap call, but a wrong pick is silent. With the index the model asks for what it needs. Jev picks can be added later from the read logs.

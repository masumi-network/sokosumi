# Linear — Team Sapphire

Linear is **read-only** for a normal Sapphire run. The **PR** is the report.

## When to write

Only when the **`## Requirement` text itself must change** (human-approved product wording).

Then:

1. Inspect Linear tool schemas before writes.
2. `get_issue` first.
3. `save_issue` with full merged `description` — update Requirement; do not invent `## Sapphire status` or phase sections. Prefer stripping legacy Sapphire status / Investigation / Spec blocks if present when you already touch the description.
4. Optional: one `save_comment` explaining **what changed in the Requirement and why** — not a phase progress report.

## Do not write for

- Phase start/complete
- Investigation or Spec artifacts
- Status tables (`## Sapphire status`)
- PR handoff / Bugbot / Reviewer summaries
- Issue state (`In Progress`, `In Review`, `Done`) — human owns workflow state

## Read

`get_issue` for `## Requirement` at intake. If Linear MCP is missing and you only need the requirement from the user message, continue; if you cannot read the issue and have no Requirement text, stop:

```text
Linear MCP is not loaded. Enable Linear MCP, or paste the ## Requirement into chat.
```

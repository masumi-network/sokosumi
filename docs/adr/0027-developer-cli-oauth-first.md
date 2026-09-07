# Developer CLI follows VISION: OAuth first, then Coworker loop

[`apps/cli/VISION.md`](../../apps/cli/VISION.md) is the product intent: one Developer CLI in this monorepo, Coworker developer loop first, Agent Hire later, talk to Core only, complement `/developer`. This ADR is how we sequence that loop. It does not replace the vision.

We ship a **CLI session** first: browser `/signin` OAuth, tokens in the OS keychain, fail closed if the keychain is missing. We do not mint an API key in that slice, and we do not write `~/.sokosumi` credential files. VISION allows API keys later; they come from a signed-in session, as a later slice.

After that, the CLI connects an **external runtime** as a **Coworker** in one selected Organization workspace: mentionable in Sokosumi chat, **Tasks** assigned to it. That actor is not a marketplace **Agent** and is not on the **Global Coworker list** until a later opt-in publish of the same Coworker. The sibling `sokosumi-cli` repo stays a read-only reference.

`coworker_*` keys stay on the Coworker process. The Developer CLI session does not use them. [SOK-954](https://linear.app/masumi/issue/SOK-954/checkpoint-end-to-end-runtime-and-secret-boundary) is the checkpoint that this secret boundary holds in a real runtime.

Rejected: a second CLI; Hire/Agent marketplace TUI first; treating “bring your agent” as a Hire listing; promoting a private workspace actor into a Coworker as if it were a new type (it already is a Coworker); file fallback for OAuth tokens.

PRs stay small: first-party `sokosumi_cli` seed, then `apps/cli` login, then discovery, connect, runtime, and publish.

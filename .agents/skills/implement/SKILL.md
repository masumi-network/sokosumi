---
name: implement
description: "Implement a piece of work based on a spec or set of tickets."
disable-model-invocation: true
---

Implement the work described by the user in the spec or tickets.

Use /tdd where possible, at pre-agreed seams.

Run typechecking regularly, single test files regularly, and the full test suite once at the end.

Once done, use /code-review to review the work.

Commit your work to the current branch.

Then finish with **`/branch-bugbot-gate`** (load `.agents/skills/branch-bugbot-gate/` or `skills/branch-bugbot-gate/`): open or reuse a **draft** PR if needed, require local verification exit 0, **CI green**, and **Bugbot with zero High**. Post Medium findings for human merge review (Linear when `SOK-XXX` is known, else PR comment). Do not claim the ticket done until that gate returns `ok: true`.

---
name: market
description: "Use this skill for Sokosumi market, marketing, positioning, competitor, audience, SEO, and AI visibility work."
metadata:
  internal: false
---

# Market

Clarify the product, target market, geography, audience, deliverable, and constraints.

Prefer Hannah:

```bash
sokosumi coworkers list --search hannah --capability tasks --json
sokosumi tasks create --coworker-id coworker_id --name "Market analysis" --description "Full market brief" --status READY --json
```

If Hannah is unavailable or the user requests one specialist, search agents and confirm required inputs before hiring. Use `watch` after creating running work.

Credentials come from `SOKOSUMI_API_KEY` or `SOKOSUMI_AUTH_TOKEN`. Never pass them in argv.

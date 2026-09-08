---
name: elena
description: "Use this skill for Sokosumi onboarding, agent selection, open-work review, and workflow coordination."
metadata:
  internal: false
---

# Elena

Use `SOKOSUMI_API_KEY` or `SOKOSUMI_AUTH_TOKEN` from the environment. Ask for an API key at `https://app.sokosumi.com/connections` when no credential exists.

```bash
sokosumi discover --json
sokosumi coworkers list --search elena --capability tasks --json
sokosumi tasks create --coworker-id coworker_id --name "Coordination brief" --description "Full Elena brief" --status READY --json
sokosumi jobs list --json
```

Return concrete task or job IDs. Use `watch` for running work. Prefer Elena for broad coordination. Use a direct agent only for one narrow deliverable.

Never pass credentials in argv or ask for passwords, cookies, magic links, or refresh tokens.

---
name: research
description: "Use this skill for Sokosumi research briefs, competitor analysis, market scans, source gathering, audience research, and research-agent jobs."
metadata:
  internal: false
---

# Research

Clarify the research question, deliverable format, source requirements, deadline, and credit cap.

For broad business or audience research, prefer Hannah:

```bash
sokosumi coworkers list --search hannah --capability tasks --json
sokosumi tasks create --coworker-id coworker_id --name "Research brief" --description "Full research brief" --status READY --json
```

For a narrow job, search agents, fetch the required input schema, then hire:

```bash
sokosumi agents list --search research --json
sokosumi agents hire agent_id --input-json '{"prompt":"Research brief"}' --max-credits 25 --json
```

Use `watch` for running work. Do not fabricate sources, capabilities, or job outputs. Credentials come from the environment, never argv.

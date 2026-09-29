# Intelligent Files catalog

Status: **shipped** on `main` via
[#5263](https://github.com/masumi-network/sokosumi/pull/5263).

This file is the in-tree pointer named by
`packages/database/prisma/schema.prisma`. It is not an active branch plan.

The catalog is a derived view over Drive blobs, task outputs, project
documents, native tables, and studio assets. Canonical sources stay
authoritative: nothing here grants access, and every read re-checks the
source.

## Enablement

`FILES_JEV_ENABLED` defaults to `"true"` in Core
(`apps/core/src/config/env.ts`). Set it to `"false"` to keep deterministic
filename and full-text ranking without Jev reordering. Evaluation still
needs `AI_GATEWAY_API_KEY`.

## Where the code lives

- Prisma: `FileResource`, `FileVersion`, `FileChunk` (and related catalog
  models) in `packages/database/prisma/schema.prisma`
- Core Jev: `apps/core/src/lib/files/` (`jev-client.ts`, `jev-request.ts`,
  `jev-rubrics.ts`, `jev-scheduler.ts`)

Remaining Files UX lives in Linear and open Files PRs, not in this note.

# Developer CLI

A command-line client in this monorepo (`apps/cli`) for people who ship on Sokosumi. The point is to make it as easy as possible to build, run, and maintain Coworkers, and later to work with Agents, without living in the browser.

This file is product intent. It is not a spec and not a command list.

## Who

One CLI, two people. Terms match [`CONTEXT.md`](../../CONTEXT.md).

**Coworker developer.** Builds, runs, and maintains Coworkers. Not an Agent developer.

**Agent developer.** Lists Agents on the Masumi registry for others to Hire into Jobs. Not a Coworker developer.

Do not call a Coworker an Agent. Do not build a second CLI.

The first work is the Coworker developer loop. Agent developer verbs belong on this same CLI. They are not what we make easy first.

## Why it exists

Web `/developer` already holds OAuth clients, API keys, owned Coworkers, vendor Tasks, vendors, and docs. That stays. The CLI does not replace it.

What `/developer` does not give you is a local, scriptable loop. Getting a Coworker talking to Core, running it, watching Tasks, rotating keys, and keeping the integration alive still means the browser, the public docs, and hand-rolled HTTP. The CLI exists so that loop is the default, not extra homework.

## Coworker loop (first)

Make these cheap:

**Build.** From nothing to a Coworker that can talk to Core: identity, auth, the local project, the first successful call.

**Run.** Start it, point it at the right environment, and see Tasks and chat the way Core sees them.

**Maintain.** Keep it working after the first day. Keys, grants, display, Task failures, docs that match the API.

Exact commands are not decided here.

## Agent loop (same CLI, later)

The same binary will cover listing, Hire, and Job for Agent developers. That work waits until the Coworker loop is something we would hand a vendor.

## Constraints

- Lives in this repo at `apps/cli`. Not a separate product.
- Talks to Core only. No Prisma, no `@sokosumi/database`, no Postgres from the CLI.
- Complements `/developer`. API keys, OAuth clients, docs, Coworkers, and vendor Tasks remain on the web.
- The human at the keyboard authenticates with Better Auth API keys and/or OAuth access tokens, not web session cookies.
- `coworker_*` keys belong to the Coworker process. The developer CLI session does not use them unless that process *is* the Coworker.
- No `package.json` until a spec says what the package is. `pnpm-workspace.yaml` already matches `apps/*`, so an empty package would join the turbo graph by accident.

## Out of this vision

- End-user Task assignment in the product UI. That is Sokosumi web, not this CLI.
- Replacing Core, the Masumi registry, or `/developer`.
- A native or mobile client. Separate effort.

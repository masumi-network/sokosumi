# Local database seed

Prisma seed for **local / dev / Cloud VM** PostgreSQL only. Refuses non-local `DATABASE_URL` hosts (e.g. Neon production).

## Run

After migrations are applied:

```bash
pnpm prisma:seed
```

Or from the database package:

```bash
pnpm --filter @sokosumi/database prisma:seed
```

Prisma 7 does **not** auto-seed on `migrate reset`. After a reset:

```bash
pnpm prisma:migrate:reset
pnpm prisma:seed
```

Use a **login shell** or explicit local URL in Cloud VM (injected Neon `DATABASE_URL` may shadow local config):

```bash
DATABASE_URL="postgresql://sokosumi:sokosumi@localhost:5432/core" pnpm prisma:seed
```

Idempotent — safe to run twice.

## Fixture cheat sheet

| Field | Value |
| --- | --- |
| Password (all users) | `Password123!` |
| Admin | `admin@sokosumi.local` — platform admin |
| Alice | `alice@sokosumi.local` — acme owner, personal **pro** sub, signup credits |
| Bob | `bob@sokosumi.local` — acme member, lean credits, no personal paid sub |
| Carol | `carol@sokosumi.local` — solo user |

| Org slug | Members | Subscription |
| --- | --- | --- |
| `acme` | alice (owner), bob (member) | org **starter** active + org credit bucket |
| `bootstrap` | alice (owner) | no paid subscription |

**Catalog:** categories `research`, `engineering`; 3 ONLINE agents (FREE + FIXED pricing). **Coworkers:** elena, alex, hannah, nori (Serviceplan vendor). **Tasks/jobs:** DRAFT, READY, COMPLETED tasks; COMPLETED + RUNNING jobs.

## Sample routes

- `/agents` — marketplace catalog
- `/tasks` — seeded tasks
- `/chat` — coworker picker
- `/organizations/acme/settings` — org billing (alice)

## Implementation

- Entry: `prisma/seed.ts`
- Modules: `prisma/seed/` (users, billing, catalog, coworkers, tasks/jobs)
- Guard: `assert-local-database-url.ts`

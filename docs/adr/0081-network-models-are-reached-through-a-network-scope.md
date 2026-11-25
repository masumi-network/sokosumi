# Network models are reached through a Network scope

- Status: Accepted
- Date: 2026-11-25

Sokosumi is moving Mainnet and Preprod into one deployment: one database with a `shared` schema and one schema per Network. Core has one Prisma client per schema on one pool. All of them have the same TypeScript type and expose every model, so `prisma.job.findMany()` on the shared client compiles, and on today's layout, where every schema name is `public`, it also works. It fails only once the tables are split, and nothing tells a caller which Network it is on. 96 Core files call a Network model on the default client today.

## Decisions

- **A Network scope is what Core's database module hands out for work on one Network** (`createNetworkScope(network)` in `apps/core/src/lib/db/network-scope.ts`). It carries the Network, that Network's client (`networkDb`), the shared client (`sharedDb`) and `networkTable(name)` for raw SQL. Which models are Network models is `packages/database/prisma/network-tables.json`.
- **The Network travels as an argument.** An entry point names the Network once and creates the scope; code below receives the scope, or one side of it. There is no default Network and no ambient storage (`AsyncLocalStorage`): a forgotten Network is a type error, not a query on Mainnet.
- **Network models are reached only through a scope.** The function that returns a Network's client stays in the client module, because the scope module must be loadable where that module is mocked, but only the scope module may import it (`noRestrictedImports` in `apps/core/biome.json`).
- **The two sides are narrowed in type.** `NetworkDb` offers the Network models and tagged raw SQL, `SharedDb` every other model; a call on the wrong side does not compile. `NetworkDb` carries a brand that exists in the types only, so the default client and a legacy transaction are refused where a Network client is expected. No client or transaction is wrapped at run time.
- **Neither side opens a transaction.** A transaction on a Network will be opened by the scope, so the retry rules always apply. The scope has no transaction methods yet; until it does, scoped code only reads and writes outside transactions.
- **A request gets its scope from one middleware**, on every authenticated router, as the context variable `networkScope`; a handler reads it with `requireNetworkScope(c)`.
- **Code that touches only shared models keeps the default client**, with no scope. New Core data access is still direct Prisma.
- **The default client keeps its full type until the last Network caller has moved.** The move goes cluster by cluster.
- **Built for Prisma only.** No provision for a second ORM: an unused extension point is a seam with one adapter. The scope is where a second client would be handed out later.

## Considered Options

- **Ambient storage for the Network.** Nothing to pass down, but a missing Network shows only at run time and is lost when work leaves the request (`waitUntil`, stored work).
- **Passing a bare Network value.** Every helper would choose a client again; the choice stays in 96 places.
- **Branding every transaction and SQL fragment per callback.** Guards raw SQL best, but puts a type parameter on every helper along a transaction, for mistakes the split-layout CI job already catches.
- **Handles that carry the table-name helper themselves.** Needs live clients and transactions wrapped at run time.
- **Narrowing the default client now.** One change over 96 files that later work rewrites.

## Consequences

- The narrowed types do not see a relation `include` that crosses the two sides, and they do not see raw SQL. The split-layout CI job does.
- Once the scope opens transactions: inside a callback `scope.networkDb` compiles and runs outside the transaction; use the callback's `tx`.
- A unit test of code that takes a scope passes a plain object with the members it uses, cast once to the handle type. It needs no module mock.
- The lint rule sees named imports. A namespace or dynamic import of the client module passes it and must be caught in review.
- Until the default client is narrowed, a Network model on it still compiles. Nothing lists those files yet; a scan with a shrinking allowlist is planned.

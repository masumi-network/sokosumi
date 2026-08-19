# Run Soko Bot in a monorepo-owned Eve service with Core as control plane

Soko Bot runs in standalone `apps/soko-bot` on Vercel Eve/Sandbox, while Core remains sole owner of data, policy, classification, Context packets, schedules, memory, audit projection, and Task/Job mutations. This remote-but-owned seam uses a Core `SokoBotRuntime` port with Eve HTTP and in-memory adapters; Core→Eve request JWTs and turn grants plus Eve→Core project-pinned Vercel OIDC replace Hermes's broad global service token. Separation preserves independent durable-runtime scaling and rollback without putting database authority or ambient user impersonation inside agent runtime.

Each Core turn creates a dedicated Eve session using durable Core turn id as Eve create `operationId`. Core does not use Eve follow-up messaging because Eve 0.38.3 only deduplicates session creation. Bounded recent conversation, current Sokosumi Context, and canonical `MEMORY.md` are rehydrated into every session, preserving continuity while making ambiguous acceptance retries exactly-once.

Turn execution is credit-metered in Core and available only with paid-plan
coverage plus personal credits; bot creation remains available to every
authenticated user. Cutover is a frozen hard cut with no dual writer or reverse
sync: migration preserves user-visible Hermes messages plus step count, never
raw step/reasoning payloads, and validated all-or-nothing command imports
external schedules. External Composio revocation evidence remains required
before decommission.

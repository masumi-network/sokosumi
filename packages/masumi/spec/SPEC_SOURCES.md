# OpenAPI spec snapshots

The hey-api clients under `src/clients/openapi/generated/` are generated from
the committed spec snapshots in this directory — never from live deployment
URLs — so regeneration is deterministic and spec changes show up as reviewable
diffs.

Refresh the snapshots from the deployed services with:

```sh
pnpm --filter @sokosumi/masumi fetch:specs
```

then regenerate the clients:

```sh
pnpm --filter @sokosumi/masumi generate:api
```

Record the new provenance below whenever a snapshot changes.

## Current snapshots

| File | Source | Version | Recorded |
| --- | --- | --- | --- |
| `payment.openapi.json` | `https://payment.masumi.network/api-docs` | 1.0.0 | 2026-08-07 |
| `registry.openapi.json` | `https://registry.masumi.network/api-docs` | 0.1.2 | 2026-08-07 |

## Why these hosts

`fetch:specs` defaults to the deployments Core actually calls at runtime — the
hosts behind `PAYMENT_API_URL` and `REGISTRY_API_URL` in
`apps/core/.env.example`. A generated client is only as correct as the server it
was generated from, so a snapshot taken from any other deployment would freeze a
contract nobody talks to.

That matters more here than for a live-URL setup, because a snapshot is stale by
design: the version guard below cannot catch drift between two deployments that
share a version number, and both of these have held their version across
releases.

Override per run to generate against a staging or local node:

```sh
PAYMENT_SPEC_URL=... REGISTRY_SPEC_URL=... pnpm --filter @sokosumi/masumi fetch:specs
```

Earlier snapshots (2026-07-27/28) were lifted from the service repos —
masumi-payment-service `codex/cardano-purchase-readiness` and
masumi-registry-service `dev` @ `fe9ac5e` — because the deployments had not yet
been upgraded to the V2/x402 release. They have been since, and the deployed
specs are byte-identical to those snapshots, so the two sources have converged.

## Guards

`fetch:specs` refuses to overwrite a snapshot with a lower `info.version`
(deployment lagging behind the pin). Because upstream payment specs may retain
the same version across releases, it also requires V2/x402 schema landmarks.
Run with `FORCE=1` only for an intentional contract downgrade.

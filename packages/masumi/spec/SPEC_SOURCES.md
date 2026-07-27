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
| `payment.openapi.json` | masumi-payment-service `dev` @ `98e3470a` (checked-in `frontend/openapi-docs.json`) | 1.0.0 | 2026-07-27 |
| `registry.openapi.json` | masumi-registry-service `dev` @ `fe9ac5e` (checked-in `src/utils/swagger-generator/openapi-docs.json`) | 0.1.2 | 2026-07-27 |

Both snapshots come from the service repos directly (not the deployed
`/api-docs` endpoints) because the deployments had not been upgraded to the
V2/x402 release when the snapshots were taken. Once the deployments are
upgraded, `fetch:specs` fetches from them.

`fetch:specs` refuses to overwrite a snapshot with a lower `info.version`
(deployment lagging behind the pin); run with `FORCE=1` to override.

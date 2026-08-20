# Research 002: What the payment node and registry already give us for x402

Resolves ticket [`002-research-node-x402-and-registry`](../tickets/002-research-node-x402-and-registry.md).
Pinned-spec audit only — every claim below is sourced from files in this repo:
`packages/masumi/spec/payment.openapi.json` (payment node v1.0.0, snapshot
2026-08-07 from `payment.masumi.network`), `packages/masumi/spec/registry.openapi.json`
(registry v0.1.2, same snapshot date), the Core ingestion code, and
`docs/adr/0001-x402-evm-payment-rail.md`. Provenance:
`packages/masumi/spec/SPEC_SOURCES.md`.

---

## 1. The `POST /x402/pay` contract

**Direct answer.** The endpoint is fully specced for the happy path and PR 1
can build against it: request = `evmWalletId` (required) + the forwarded 402
body as `paymentRequired` (required) + three optional narrowing fields;
response = a signed `X-PAYMENT` header plus an `attemptId` and the exact
network/asset/amount/payTo that was signed. What is NOT specced: any error
response (only `200` is declared), any idempotency behavior, the semantics of
`paymentIdentifier`, and the rule for choosing among multiple `accepts`
options. Treat retries as potentially double-charging until the node team says
otherwise.

**Request** (`payment.openapi.json:27863` ff.):

- `evmWalletId` — **required** string. "Managed EVM wallet to sign the payment
  with."
- `paymentRequired` — **required** object, "The 402 Payment Required response
  the buyer received." Inside it, required: `x402Version` (integer) and
  `accepts` (array, `minItems: 1`, `maxItems: 20`). Each `accepts` item
  requires `scheme`, `network`, `asset`, `amount` (`^\d+$`), `payTo`,
  `maxTimeoutSeconds` (integer > 0); `extra` is optional. Optional on
  `paymentRequired`: `resource` (object with `url`), `extensions` (free-form
  object), `error`.
- `preferredNetwork` — **optional**, `^eip155:\d+$`, "Restrict signing to this
  CAIP-2 network."
- `preferredAsset` — **optional**, `^0x[a-fA-F0-9]{40}$`, "Restrict signing to
  this token asset."
- `paymentIdentifier` — **optional**, 16–128 chars, `^[a-zA-Z0-9_-]+$`,
  **no description at all** (`payment.openapi.json:27972`). Its semantics
  (correlation id? dedup key? Masumi extension echo?) are undocumented.

**Response 200** (`payment.openapi.json:28023` ff.) — `data` with ALL fields
required:

- `attemptId` — the payment-attempt id.
- `payer` (`^0x…40$`) — "The managed wallet address that signed the payment."
- `caip2Network`, `asset`, `amount` (base units), `payTo` — what was actually
  signed (the node's selection among `accepts`).
- `xPaymentHeader` — "Base64 X-PAYMENT header value; the buyer sends this with
  its own retried request" (`payment.openapi.json:28049`).
- `paymentPayload` (free-form object), `paymentPayloadHash`,
  `paymentIdentifier` (nullable).

Operation description (`payment.openapi.json:27865`): "Signs a payment for a
forwarded 402 using a managed EVM wallet, **charged against the caller
budget**. Returns the X-PAYMENT header for the caller to send with its own
retried request; **this service never fetches the resource itself**."
Security: `API-Key` header `token`, "pay access required".

**Error modes: none declared.** `.paths["/x402/pay"].post.responses` contains
exactly one key, `"200"`. No 400/401/402/409 shape exists anywhere on this
operation (other operations in the same spec do declare a `401`, e.g.
`/rail-readiness`, so this is a genuine omission, not a spec-wide
convention). Budget-exhausted, wallet-not-found, chain-not-allowed, and
no-acceptable-option failures have no documented status code or body.

**Idempotency: absent.** No idempotency key, no replay semantics, no
uniqueness constraint documented on `paymentIdentifier`. The contrast is
explicit in the same file: `/x402/settle` is documented "Idempotent per
payment payload hash" (`payment.openapi.json:27579`) and returns a
`replay: boolean` (`payment.openapi.json:27779`); `/x402/pay` says nothing.
As pinned, a retried `/x402/pay` must be assumed to create a new attempt and
charge the budget again.

**Guaranteed vs ambiguous.** Guaranteed: field shapes above, budget charging,
node-never-fetches, one signed option returned with its exact tuple.
Ambiguous: retry/dedup behavior; `paymentIdentifier` meaning; selection rule
when several `accepts` survive `preferredNetwork`/`preferredAsset` filtering;
the attempt's status after signing (the response carries no status field).

---

## 2. Wallet / budget / network / payments surfaces

**Direct answer.** Everything PR 1's operator runbook needs exists, all
API-key scoped: chains are configured via `/x402/networks` (admin), buy
wallets via `/x402/wallets` (pay), spend caps via `/x402/budgets` (admin,
per API-key + wallet + chain + asset, base units), and after a payment Soko
can query `/x402/payments` — but only as a filtered list, **not by
`attemptId`** (see the drift audit, §5). Discovery of usable chains for the
buy side is `/x402/networks/available` (pay access).

**Networks.**

- `GET/POST /x402/networks` (admin; `payment.openapi.json:26535`) manage
  `X402Network` rows (`payment.openapi.json:5054`): `caip2Id`
  (`^eip155:\d+$`), `displayName`, `rpcUrl`, `isTestnet` ("paired with the
  Cardano Preprod environment"), `isEnabled`, nullable `defaultAsset` +
  `defaultAssetDecimals` ("null until an operator confirms them"), and the
  facilitator config — nullable `facilitatorWalletId`/`facilitatorWalletAddress`
  (self-hosted) vs nullable `facilitatorUrl` (remote).
- `GET /x402/networks/available` (pay access; `payment.openapi.json:26450`)
  returns `X402AvailableNetwork` (`payment.openapi.json:5001`): opaque `id`
  ("accepted by managed-wallet endpoints"), `caip2Id`, `isEnabled`,
  `canSettle` — "Outbound (buy) wallets do not require a facilitator, so
  networks may be listed with canSettle=false" — plus default asset/decimals.
  This is the buy-side discovery endpoint.

**Wallets** (`payment.openapi.json:26757` ff., all "pay access", owner and
network scoped):

- `POST /x402/wallets` body: `networkId` + `type` (`Purchasing` | `Selling`)
  required; optional `note` (≤250) and `privateKey` (`^0x[0-9a-f]{64}$`,
  generated when omitted). Response `X402WalletCreated`
  (`payment.openapi.json:5200`) returns the generated `privateKey` **once**:
  "never stored in plaintext, and can never be retrieved again."
- `X402Wallet` (`payment.openapi.json:5140`): `id`, `networkId`,
  `caip2Network`, `address`, `type` ("Purchasing wallets fund outbound
  payments; Selling wallets settle inbound ones as facilitators"), `note`,
  `createdById`, timestamps.
- Also: `/x402/wallets/detail`, `/update`, `/delete` (retire), `/count`, and
  `/x402/wallets/balance` returning per-chain `native` (gas, wei) and `asset`
  (token base units) balances with a per-chain `error` field.

**Budgets** (`payment.openapi.json:27128`, admin):

- `X402Budget` (`payment.openapi.json:5220`): `apiKeyId` ("API key the budget
  is granted to"), `evmWalletId` + resolved `evmWalletAddress`,
  `caip2Network`, `asset` ("Token contract the budget is denominated in"),
  `remainingAmount` / `spentAmount` (base-unit strings).
- `POST /x402/budgets` requires all of `apiKeyId`, `evmWalletId`,
  `caip2Network`, `asset`, `remainingAmount` (`^\d+$`). A budget is therefore
  scoped to an exact (API key, wallet, chain, ERC-20) tuple.

**Payments** (`payment.openapi.json:28121`, pay access; "non-admin keys see
only their own"):

- Item shape `X402PaymentAttempt` (`payment.openapi.json:5283`): `id`,
  `direction` (`InboundVerify` | `InboundSettle` | `OutboundPayment`),
  `status` (`PaymentRequired` | `Verified` | `Settled` | `Failed` |
  `Replayed`), `apiKeyId`, nullable `evmWalletId`, `caip2Network`, `asset`,
  `amount`, nullable `payTo` ("Immutable payee-address snapshot"), `payer`,
  `resource`, `paymentIdentifier`, `errorReason`/`errorMessage`, nullable
  `facilitator` ("null for outbound payments and verifies") and nullable
  `Settlement` (with `txHash`).
- Query filters: `take`, `cursorId` (pagination only — "the id of the last
  returned attempt"), `status`, `direction`, `side` (`buy` = outbound, `sell`
  = inbound), `caip2Network`, `filterNeedsManualAction` (stuck-settle triage).
  **There is no `id`/`attemptId`/`paymentIdentifier` filter and no
  `/x402/payments/{id}` detail route.**
- Supporting: `/x402/payments/count`, `/x402/settlements(+/count)`,
  `/x402/payments/reconcile` (admin, inbound settles), `/x402/low-balance`
  rules (admin), `/x402/analytics` (admin).

**Operator setup PR 1 requires** (all node-side): enable the target chain(s)
with an RPC URL (`POST /x402/networks`, admin); create a `Purchasing` wallet
bound to each chain (`POST /x402/wallets`) and fund it out-of-band; grant the
Soko API key a budget per chain+asset (`POST /x402/budgets`, admin); ensure
the key's `ChainIdLimit` — "CAIP-2 chain identifiers this API key is allowed
to access" (`payment.openapi.json:70`) — covers the `eip155:*` ids.

---

## 3. Rail readiness for buy-side x402

**Direct answer.** Both checks the ticket asks about exist in the pinned
spec: `x402.purchasing_wallet` and `x402.budget` are members of the check-id
enum in the `RailReadiness` schema. But they are (a) explicitly
**non-blocking** — they never affect the X402 rail's `isReady`, which is a
sell-side gate — and (b) **global per environment, not per network**: the
X402 rail block carries one flat `Checks` array; only CardanoV2 gets
per-source `PurchaseSources`. Soko's existing readiness plumbing maps over
cleanly at the transport level (same endpoint, same polling job) but today it
reads only the CardanoV2 block, and a per-EVM-network gate cannot be built
from `/rail-readiness` alone.

**Spec evidence** (`payment.openapi.json:30416` for the path, `:5895` for
`RailReadiness`):

- Query: `network` = `Preprod` | `Mainnet`, required. "x402 chains are grouped
  in by their testnet flag" — so one call per environment, EVM chains folded
  into the Cardano environment split.
- Check-id enum (`RailReadiness` schema): `x402.enabled_chain`,
  `x402.rpc_url`, `x402.facilitator`, `x402.selling_wallet`,
  `x402.purchasing_wallet`, `x402.budget` (plus the seven `cardano.*` ids).
  Each check: `id`, `label`, `isComplete`, nullable `detail`.
- Operation description: "isReady covers blocking checks only: for x402 that
  means an enabled chain with exactly one facilitator mode configured (a row
  with both a facilitator wallet and a facilitator URL fails at settle time),
  **while purchasing wallet and budget are reported but optional**."
- The example response shows the X402 rail `isReady: true` with
  `x402.purchasing_wallet` and `x402.budget` both `isComplete: false`,
  `detail: "Optional — needed only to pay other agents"`.
- `PurchaseSources` (per policy/contract, with its own buy-direction `Checks`)
  is described only for CardanoV2: "Per-source outbound purchase readiness for
  CardanoV2." Nothing per-chain exists for x402.

**How it maps onto Soko's Cardano-V2 readiness pattern:**

- The pattern: `syncCardanoV2RailReadiness`
  (`apps/core/src/services/agent-sync.readiness.ts:25`) polls
  `/rail-readiness`, persists the ready-source set under the `syncMetadata`
  key `cardano-v2-rail-readiness`, keeps last-known-value on check failure
  (warm) and alerts differently when nothing was ever recorded (cold);
  a changed set triggers a registry replay. Availability reads it via
  `getCardanoV2ReadySources` (`apps/core/src/helpers/agent.ts:270`), which is
  "Deliberately NOT expired on age" (`agent.ts:257`).
- The current client reads ONLY the CardanoV2 rail and errors when
  `PurchaseSources` is missing
  (`packages/masumi/src/clients/masumi-payment.client.ts:390-397`); the X402
  rail block in the same response is ignored today.
- An x402 analog can reuse the poll + `syncMetadata` + replay-on-change
  machinery unchanged, gating on `x402.purchasing_wallet.isComplete &&
  x402.budget.isComplete` — but only as one environment-wide boolean. A
  per-network gate (which ADR 0001 §6 calls for) must be composed from
  `/x402/networks/available` (enabled chains) + `/x402/wallets?type=Purchasing`
  (wallet per `networkId`) + `/x402/budgets` (budget rows per
  `caip2Network`/`asset`), or wait for the node to grow per-chain checks.

---

## 4. Registry X402 entries and what Soko persists

**Direct answer.** The registry spec fully describes X402 entries — entry
`type: "X402"`, nullable `x402ResourcesUrl`, and per-source payment data
whose plain-string fields carry CAIP-2 networks and ERC-20 assets with
optional decimals — and Soko already ingests and stores ALL of it, then
excludes X402 entries from the hireable catalog by entry type. Bazaar is not
representable in the pinned registry spec at all: registry sources are
Cardano policy registrations only, so "does the deployed registry index
Bazaar?" cannot be answered from this repo — that is the named external gap.

**What the registry serves** (`registry.openapi.json`, `RegistryEntry` at
`:458`; the same fields appear on `PaymentInformation` at `:23`):

- `type` enum: `Standard` | `OpenApi` | `X402` (`:497-503`).
- `x402ResourcesUrl`: nullable string (`:514`), sibling of `apiBaseUrl` and
  `openApiSpecUrl` — an X402 entry is a pointer, not a MIP-003 endpoint.
- `paymentType` enum is only `Web3CardanoV1` | `Web3CardanoV2` | `None`
  (`:570-576`) — there is no x402/EVM payment type; EVM-paid entries ride on
  `None`.
- `SupportedPaymentSources[]` (`:690` ff.), all keys required (several
  nullable): `chain` (string), `network` (string — this is where a CAIP-2 id
  travels), `sourceIndex` (int ≥ 0), `paymentSourceType` (nullable),
  `address`, `scheme` (nullable — the x402 scheme slot), `payTo` (nullable),
  `resource` (nullable), and `pricing`: `Fixed` (`fixed[]` of
  `{asset, amount, decimals? 0..255}`), `Dynamic` (`dynamic[]` of
  `{asset, decimals}`, max 1), or `Free`. No EVM-specific pattern anywhere —
  CAIP-2 network and ERC-20 asset are carried as plain strings.

**What Soko persists** (ingestion path `syncRegistryAgents` →
`apps/core/src/services/agent-sync.service.ts:269-270, 369, 578`):

- `convertEntryType` maps `"X402"` → `AgentEntryType.X402`, unknown future
  types → `UNKNOWN` (`apps/core/src/services/agent-sync.projection.ts:135-150`);
  `x402ResourcesUrl` is stored via `buildRegistryAgentFields`
  (`agent-sync.projection.ts:779`). Both are `nullish` in the storage schema
  so a pre-V2 registry degrades to the V1 projection instead of quarantining
  (`agent-sync.projection.ts:196-199`).
- `buildPaymentSourceRows` (`agent-sync.projection.ts:710-762`) mirrors every
  source — `sourceIndex`, `chain`, `network`, `paymentSourceType`, `address`,
  `payTo`, `scheme`, `resource`, projected `pricingType`, and fixed amounts
  zipped with their `decimals` — into `AgentPaymentSource` /
  `AgentPaymentSourceAmount`.
- Schema sockets (`packages/database/prisma/schema.prisma`):
  `AgentEntryType` enum with `X402` (`:621`), `Agent.x402ResourcesUrl`
  (`:731`), `AgentPaymentSource.network` — "Cardano network name or CAIP-2 id
  (e.g. eip155:8453) as served by the registry — a plain string on purpose so
  EVM rails need no schema change" (`:641-642`) — and
  `AgentPaymentSourceAmount.unit` — "Chain-native asset identifier (Cardano
  unit or EVM ERC-20 address)" with optional `decimals` (`:665-668`).
- **Availability exclusion**: `buildAvailableAgentWhereClause` hard-filters
  `type: AgentEntryType.STANDARD` — "Only Standard entries with a MIP-003
  endpoint can be hired; OpenApi and X402 pointer entries have no job flow
  yet" (`apps/core/src/helpers/agent.ts:374-376`) — and allowlists
  `paymentType` to V1/None(/V2 when ready). So X402 entries are fully stored,
  never shown.

**Bazaar.** The pinned registry spec cannot express a Bazaar source:

- `POST /registry-source/` (`registry.openapi.json:2713` ff.) accepts exactly
  `{policyId, note, rpcProviderApiKey, network: Preprod|Mainnet}` — a Cardano
  on-chain policy crawl is the only source kind that can be configured.
- The `RegistrySource` schema (`:1069` ff.; fields `id`, `url`, `policyId`,
  `note`, `latestPage`, `latestIdentifier`, `rpcProviderApiKey`, `network`)
  has no source-type discriminator; `/registry-diff/` filters by `policyId`
  only (`:3039` ff.). The words "Bazaar", "index", or any Web2 crawl concept
  appear nowhere in the file.
- Therefore X402 registry entries, as specced, exist only when someone
  registers them **on Cardano under a registry policy**. Whether the deployed
  `registry.masumi.network` additionally indexes Coinbase Bazaar (through
  unspecced internals) is unanswerable from this repo. **Named gap: registry
  indexing of Bazaar is an unshipped/unverifiable external dependency; the
  registry team must confirm whether Bazaar-sourced X402 entries exist or are
  planned, and under what `RegistrySource` they would surface.** (Bazaar
  mechanics themselves are ticket 001's scope.)

---

## 5. ADR 0001 drift audit (ADR says X, spec says Y)

Matches first, then drift. ADR: `docs/adr/0001-x402-evm-payment-rail.md`.

**Matches the pinned spec:**

- ADR:34-36 `/x402/pay` field list — matches (`payment.openapi.json:27863`).
  (ADR omits that only `evmWalletId` + `paymentRequired` are required; minor.)
- ADR:37-39 X402 `isReady` covers receiving only; buy side is
  `x402.purchasing_wallet`/`x402.budget` — matches the operation description
  ("purchasing wallet and budget are reported but optional").
- ADR:85-90 flow (forward 402, replay with returned header, node never
  fetches) — matches the `/x402/pay` description verbatim in substance.
- ADR:119 `ChainIdLimit` — exists: "CAIP-2 chain identifiers this API key is
  allowed to access" (`payment.openapi.json:70-77`).
- ADR:30 "no on-chain refund path" — consistent: the spec's refund endpoints
  (`/payment/authorize-refund`, `/purchase/request-refund`) are
  Cardano-escrow surfaces; no x402 refund endpoint exists.

**Drift:**

1. **Outbound lifecycle terminal at `Verified`.** ADR:27-29 and ADR:78-81 say
   the outbound attempt lifecycle is "`PaymentRequired` → `Verified` |
   `Failed`, terminal at `Verified`". Spec: `X402PaymentAttempt.status` is a
   flat five-value enum (`PaymentRequired`, `Verified`, `Settled`, `Failed`,
   `Replayed`; `payment.openapi.json:5283` ff.) with **no direction-scoped
   lifecycle documented anywhere**, and the `/x402/pay` response carries no
   status. The ADR's terminal-state claim is plausible but unverifiable from
   the pin — needs node-team confirmation before `JobX402Payment` hardcodes it.
2. **`/x402/payments` lookups by `attemptId`.** ADR:93 and ADR:152 assume
   "lookups by `attemptId`". Spec: `GET /x402/payments` filters are `take`,
   `cursorId` (pagination only), `status`, `direction`, `side`,
   `caip2Network`, `filterNeedsManualAction` — **no id filter and no
   `/x402/payments/{id}` route exists**. As pinned, confirming a specific
   attempt means paginating and matching client-side.
3. **"The same cached, TTL'd fail-closed pattern used for Cardano V2
   readiness … extended per EVM network"** (ADR:112-113). Two drifts, one
   against our own code and one against the spec: (a) the actual Cardano V2
   pattern is deliberately **not** TTL'd and serves last-known-value on check
   failure (`apps/core/src/helpers/agent.ts:256-263`,
   `agent-sync.readiness.ts:10-23`) — fail-closed only in the never-recorded
   cold state; (b) `/rail-readiness` exposes x402 checks **once per
   environment**, not per network (no x402 `PurchaseSources` analog), so
   "extended per EVM network" is not buildable from that endpoint as pinned
   (see §3).
4. **`paymentIdentifier` = Masumi payment-identifier extension** (ADR:74-75,
   87). Spec: the request field has no description and no documented link to
   `paymentRequired.extensions`; the extension semantics are an ADR assertion,
   not a spec guarantee.
5. **Failure handling assumes distinguishable errors** (ADR:92-98). Spec:
   `/x402/pay` declares no non-200 responses at all, so "timeouts and non-2xx
   replays" can be classified on Soko's side of the wire, but node-side
   failures (budget exhausted, wallet missing, no matching accept) have no
   documented shape to branch on.

---

## Unresolved / external dependencies

> *(Superseded — every item below is resolved: the payment-node questions were
> answered in-house (see [NODE-QUESTIONS.md](../NODE-QUESTIONS.md) `## Answers`
> and [MAP.md](../MAP.md)), and the registry/Bazaar question is closed by
> [ticket 010](../tickets/010-bazaar-source-of-truth.md). Kept as the
> pinned-spec audit of record.)*

Needs the **payment-node team**:

1. `/x402/pay` error contract — no non-200 response is specced; the shapes for
   budget-exhausted, unknown wallet, chain not in `ChainIdLimit`, and
   no-acceptable-`accepts` failures are needed before Soko can map them to
   user-facing job errors.
2. `/x402/pay` idempotency and `paymentIdentifier` semantics — undocumented;
   confirm whether retrying (with or without the same `paymentIdentifier`)
   creates a second attempt and charges the budget twice.
3. Outbound attempt terminal status — confirm `OutboundPayment` attempts stop
   at `Verified`/`Failed` (and whether `Replayed` can apply to them), since
   ADR 0001 §3 encodes that lifecycle into `JobX402Payment`.
4. By-id lookup on `/x402/payments` — an `attemptId` (or `paymentIdentifier`)
   filter or a detail route; ADR 0001's status tooling depends on it and the
   pinned spec has neither.
5. Per-EVM-network buy-side readiness — either per-chain x402 checks (a
   `PurchaseSources` analog) on `/rail-readiness`, or Soko composes
   `/x402/networks/available` + `/x402/wallets` + `/x402/budgets` itself;
   decide which before implementing ADR 0001 §6.
6. `accepts` selection rule — which option `/x402/pay` signs when several
   survive `preferredNetwork`/`preferredAsset` narrowing.

Needs the **registry team**:

7. Bazaar indexing — the pinned registry spec can only configure Cardano
   policy sources (`POST /registry-source/`), so whether the deployed registry
   indexes Coinbase Bazaar today, plans to, and how such entries would be
   sourced/attributed is unanswerable from this repo. Until confirmed, treat
   Bazaar-sourced X402 agents as an unshipped external dependency; Soko-side
   ingestion of policy-registered X402 entries is already complete (§4).

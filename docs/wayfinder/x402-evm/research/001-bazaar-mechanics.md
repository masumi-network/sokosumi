# Research: How the x402 Bazaar actually works

Resolves ticket [`001-research-bazaar-mechanics`](../tickets/001-research-bazaar-mechanics.md).

Method note: external claims were checked against the live systems on
**2026-08-10** — the CDP Bazaar discovery API and the x402.org facilitator were
queried directly, and the protocol specs were read from the `coinbase/x402`
repo at `main`. Each claim below is marked **verified** (observed live or read
in the authoritative spec) or **inferred**. Question 5 uses only the pinned
in-repo spec `packages/masumi/spec/payment.openapi.json` (snapshot of
`payment.masumi.network`, version 1.0.0, recorded 2026-08-07 per
`packages/masumi/spec/SPEC_SOURCES.md`).

---

## 1. What the Bazaar/index is

**Direct answer:** The x402 Bazaar is Coinbase's discovery index for
x402-payable resources, operated as part of the **CDP (Coinbase Developer
Platform) facilitator**. Resources that settle through the CDP facilitator and
opt in (`discoverable: true` / the `bazaar` extension) get indexed
automatically; listing is free. Discovery reads are **public — no CDP API
key**. The generic "Discovery API" is also standardized in the x402 v2 spec
(section 8), so any facilitator may run its own bazaar; Binance already clones
the pattern ("B402 Bazaar").

**Endpoints (verified live 2026-08-10):**

- `GET https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources` —
  list, offset pagination (`type`, `limit` (spec: 1–100, default 20),
  `offset`). Returns `{ items: [...], pagination: { limit, offset, total } }`.
- `GET https://api.cdp.coinbase.com/platform/v2/x402/discovery/search` —
  full-text/semantic search. Params (per CDP API reference): `query`,
  `network`, `asset`, `scheme`, `payTo`, `urlSubstring`, `maxUsdPrice`,
  `extensions`, `tags`, `curatedOnly`, `limit` (1–20). Returns
  `{ resources, partialResults, searchMethod (text|vector|hybrid), x402Version }`.
- A third "list merchant discovery info" endpoint exists per CDP docs (not
  exercised).

**Per-resource fields (verified against live responses):**

| Field | Observed |
| --- | --- |
| `resource` | Absolute URL of the paid endpoint (e.g. `https://api.onesource.io/api/chain/block-number`) |
| `type` | `"http"` |
| `x402Version` | `2` (some `1` remain per search-API docs) |
| `accepts` | Array of PaymentRequirements — see §2. Full pricing is advertised up front |
| `lastUpdated` | ISO-8601 string in the wild (`"2026-08-10T10:20:27.801Z"`) — **diverges from spec**, which says Unix timestamp number |
| `metadata` | Optional (category, provider) |
| `extensions.bazaar` | `{ info: { input: { type: "http", method, queryParams/body }, output: { type, example } }, schema: <JSON Schema for info> }` — machine-readable call contract |
| `quality` | `{ l30DaysTotalCalls, l30DaysUniquePayers, lastCalledAt }` — **wild-only**, not in the protocol spec |

Wild divergence: live `accepts` entries duplicate `asset` as `currency` and
`payTo` as `recipient` (non-spec alias fields).

**Sources:**
- Live: `https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources?limit=3` (2026-08-10)
- Live: `https://api.cdp.coinbase.com/platform/v2/x402/discovery/search?query=weather&limit=1` (2026-08-10)
- https://docs.cdp.coinbase.com/x402/bazaar ("Bazaar discovery is public. You do not need a CDP API key")
- https://docs.cdp.coinbase.com/api-reference/v2/rest-api/x402-facilitator/search-x402-resources
- https://www.coinbase.com/developer-platform/discover/launches/x402-bazaar (launch, operator, `discoverable: true` listing)
- https://github.com/coinbase/x402/blob/main/specs/x402-specification-v2.md §8 (Discovery API, Bazaar concept)
- https://github.com/coinbase/x402/blob/main/specs/extensions/bazaar.md (the `bazaar` extension a server puts in its 402)
- https://developers.binance.com/docs/onchainpay-x402/b402-bazaar (pattern cloned by another operator; existence only)

---

## 2. The exact 402 response

**Direct answer:** Two protocol generations coexist. **v1** returns HTTP 402
with a JSON **body** `{ x402Version: 1, error, accepts: [...] }` where each
requirement uses `maxAmountRequired` and human network names
(`"base-sepolia"`). **v2** (spec dated 2025-12-09) moves the payload into a
base64 `PAYMENT-REQUIRED` response header: `{ x402Version: 2, error,
resource: { url, description, mimeType }, accepts: [...], extensions: {} }`
with `amount` and **CAIP-2** network ids (`eip155:8453` = Base mainnet,
`eip155:84532` = Base Sepolia). The Bazaar resources sampled live are v2.
There is **no server nonce and no validity window in the 402 itself** — the
nonce and time window are chosen by the *client* when it signs (see §3);
`maxTimeoutSeconds` is the server's bound on how long payment completion may
take.

**v2 `PaymentRequirements` entry (verified, spec + live):**

```json
{
  "scheme": "exact",
  "network": "eip155:8453",
  "amount": "1000",
  "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "payTo": "0x52E29e0d2Aa49bfBfC548C0A9F2196F4aa51f3ea",
  "maxTimeoutSeconds": 3600,
  "extra": { "name": "USD Coin", "version": "2" }
}
```

- `amount`: string, **atomic token units** (`"1000"` = 0.001 USDC at 6
  decimals). `asset`: ERC-20 contract address (USDC on Base
  `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` dominates the sampled listings).
- `extra.name` / `extra.version` are the token's **EIP-712 domain** values,
  needed to sign the authorization.
- `maxTimeoutSeconds` observed in the wild: 60–3600.

**Schemes in the wild (observed):**
- `exact` — everywhere; the default.
- `batch-settlement` — offered *alongside* `exact` by several live Base-mainnet
  resources (extra: `receiverAuthorizer`, `withdrawDelay: 86400`).
- `upto` — advertised by the x402.org facilitator on `eip155:84532` (testnet);
  not seen on sampled mainnet Bazaar listings.
- Spec repo defines `exact` (EVM, SVM, Algorand, Aptos, Hedera, Keeta,
  Stellar, Sui), `upto`, `batch-settlement`.

**Sources:**
- https://github.com/coinbase/x402/blob/main/specs/x402-specification-v2.md §5.1
- https://github.com/coinbase/x402/blob/main/specs/x402-specification-v1.md §5.1
- https://github.com/coinbase/x402/blob/main/specs/transports-v2/http.md and `specs/transports-v1/http.md`
- Live facilitator: `https://x402.org/facilitator/supported` (2026-08-10) — v2 kinds in CAIP-2, v1 kinds as `"base-sepolia"`/`"solana-devnet"`
- Live Bazaar listing sample (2026-08-10), as in §1

---

## 3. The `X-PAYMENT` header, verification, and the facilitator

**Direct answer:** Yes — for the `exact` scheme on EVM the payment header
carries an **EIP-3009 `transferWithAuthorization` payload**: an EIP-712
`signature` plus the `authorization` tuple
`{ from, to, value, validAfter, validBefore, nonce }`, base64-encoded JSON.
In **v1** the header is `X-PAYMENT` and the JSON is
`{ x402Version: 1, scheme, network, payload }`. In **v2** the header is
renamed **`PAYMENT-SIGNATURE`** and the JSON is
`{ x402Version: 2, resource?, accepted, payload, extensions }` where
`accepted` is the chosen PaymentRequirements entry echoed back verbatim.
Verification and settlement are delegated to a **facilitator**; the settlement
result returns in the `X-PAYMENT-RESPONSE` (v1) / `PAYMENT-RESPONSE` (v2)
header.

**Facilitator role (verified in spec):** the resource server POSTs
`{ x402Version, paymentPayload, paymentRequirements }` to the facilitator:

- `POST /verify` — stateless checks: signature recovers to
  `authorization.from`; payer balance sufficient; amount/time-window/params
  match requirements; token+network match; **simulate**
  `transferWithAuthorization`. Returns `{ isValid, invalidReason?, payer }`.
  Verify does **not** consume the authorization.
- `POST /settle` — broadcasts `transferWithAuthorization(...)` on the ERC-20;
  the facilitator pays gas but **cannot alter amount or destination** (both
  are inside the signed message). Returns
  `{ success, transaction, network, payer, errorReason? }`.
- `GET /supported` — `{ kinds: [{x402Version, scheme, network}], extensions,
  signers }`. Verified live on x402.org (public, testnet-oriented; extensions
  advertised there: `builder-code`, `eip2612GasSponsoring`,
  `erc20ApprovalGasSponsoring`). The CDP facilitator's `/supported` returned
  `Unauthorized` — CDP verify/settle require a CDP API key; only its
  *discovery* endpoints are public.

v2 `exact`/EVM also standardizes two fallback transfer methods beside EIP-3009:
**Permit2** (`permitWitnessTransferFrom` via canonical proxy
`0x402085c248EeA27D92E8b30b2C58ed07f9E20001`) and **ERC-7710** delegation —
EIP-3009 remains the recommended default for USDC.

**What the caller must preserve between the 402 and the replay (verified):**

1. The **chosen `accepts` entry, byte-for-byte** — v2 requires echoing it as
   `accepted`; its `payTo`→`to`, `amount`→`value`, and `extra`
   (EIP-712 domain name/version) feed the signature.
2. The **`extensions` object** — the client must echo at least the `info` the
   server sent (may append, must not delete/overwrite).
3. The **resource URL and the original request** (method, body) — the retry is
   a fresh request to the same resource carrying the payment header.
4. Its own signed tuple (nonce, validAfter/validBefore) if it wants to retry
   idempotently rather than re-sign.

**Sources:**
- https://github.com/coinbase/x402/blob/main/specs/x402-specification-v2.md §5.2, §7
- https://github.com/coinbase/x402/blob/main/specs/schemes/exact/scheme_exact_evm.md
- https://github.com/coinbase/x402/blob/main/specs/transports-v1/http.md (X-PAYMENT / X-PAYMENT-RESPONSE)
- https://github.com/coinbase/x402/blob/main/specs/transports-v2/http.md (PAYMENT-REQUIRED / PAYMENT-SIGNATURE / PAYMENT-RESPONSE)
- Live: `https://x402.org/facilitator/supported`; `https://api.cdp.coinbase.com/platform/v2/x402/supported` → `Unauthorized` (2026-08-10)

---

## 4. Replay semantics

**Direct answer:** A signed `exact` payment can be **settled on-chain exactly
once**. EIP-3009 stores
`_authorizationStates[authorizer][nonce]` and reverts a second
`transferWithAuthorization` with `"EIP3009: authorization is used"`. The
validity window is `validAfter < now < validBefore`, chosen by the **client**
at signing time; the reference client signs `validAfter = now − 600 s` and
`validBefore = now + maxTimeoutSeconds` (verified in
`coinbase/x402` `typescript/packages/legacy/x402/src/schemes/exact/evm/client.ts`),
so a payment is typically valid for the server-advertised
`maxTimeoutSeconds` (60–3600 s in the wild).

**What the agent returns (verified spec error codes):**

- Expired authorization → verify fails
  `invalid_exact_evm_payload_authorization_valid_before`; not yet valid →
  `..._valid_after`; on-chain failure → `invalid_transaction_state`.
- HTTP mapping: failed verification/settlement → **402 again** (v1: JSON body
  with `error` + fresh `accepts`; v2: `PAYMENT-RESPONSE` header with
  `{ success: false, errorReason, transaction: "" }`). Malformed payload →
  400.

**Nuances that matter for a caller/seller (verified):**

- The chain consumes the nonce only at **settlement**. `/verify` is
  read-only, so the same header replayed to a resource server *before* it
  settles is an application-layer problem — servers deduplicate by payment
  payload hash and/or the `payment-identifier` extension (§5). Masumi's
  settle is explicitly "Idempotent per payment payload hash" and its payment
  attempts carry a `Replayed` status.
- The nonce is a client-generated **random 32-byte value** (not sequential),
  so parallel payments don't order-conflict.
- A payer can void an unused authorization on-chain via
  `cancelAuthorization()` before it is settled.
- `AuthorizationUsed` event / `authorizationState()` view allow checking
  consumption on-chain.

**Sources:**
- https://eips.ethereum.org/EIPS/eip-3009 (`require(!_authorizationStates[from][nonce], "EIP3009: authorization is used")`, validAfter/validBefore requires, cancelAuthorization)
- https://github.com/coinbase/x402/blob/main/specs/x402-specification-v2.md §9 (error codes), §10.1 (replay-prevention layers)
- `coinbase/x402` repo, `typescript/packages/legacy/x402/src/schemes/exact/evm/client.ts` lines 20–27 (validAfter −600 s, validBefore + maxTimeoutSeconds, random nonce)
- In-repo: `packages/masumi/spec/payment.openapi.json` — `/x402/settle` description, `X402PaymentAttempt.status` enum incl. `Replayed`

---

## 5. Masumi-specific x402 extensions (payment-identifier)

**Direct answer:** The `payment-identifier` idempotency-key extension is an
**upstream x402 extension** (spec: `specs/extensions/payment_identifier.md`),
and the Masumi payment service implements it end-to-end: its outbound signer
accepts a `paymentIdentifier` whose format constraints (16–128 chars,
`^[a-zA-Z0-9_-]+$`) match the upstream `id` field exactly, and its inbound
verify/settle endpoints return a nullable `paymentIdentifier` plus a
`paymentPayloadHash`, with settlement idempotent per payload hash. Masumi
speaks a **hybrid dialect**: `x402Version: 1` in examples but with v2-shaped
bodies (`accepted` object, `amount`, `extensions`, CAIP-2 `eip155:*`
networks).

**Verified in the pinned spec (`packages/masumi/spec/payment.openapi.json`, v1.0.0):**

- **Upstream extension shape** (for context, from `coinbase/x402`
  `specs/extensions/payment_identifier.md`): server advertises
  `extensions["payment-identifier"] = { info: { required: bool }, schema }` in
  the 402; client echoes it adding `info.id` (16–128 chars, alphanumeric +
  `-_`, recommended `pay_<uuid>`); same id + same payload → cached response,
  same id + different payload → 409, `required: true` without id → 400.
- **`POST /x402/pay`** (buyer side): signs a payment for a forwarded 402 with
  a managed EVM wallet against the caller's budget. Optional request field
  `paymentIdentifier` (`minLength: 16, maxLength: 128, pattern:
  ^[a-zA-Z0-9_-]+$`). Response: `xPaymentHeader` ("Base64 X-PAYMENT header
  value; the buyer sends this with its own retried request"), the signed
  `paymentPayload`, `paymentPayloadHash`, and echoed `paymentIdentifier`.
  The service "never fetches the resource itself".
- **`POST /x402/verify` / `POST /x402/settle`** (seller side): accept
  `paymentPayload` containing `x402Version`, `resource.url`, `accepted`
  (scheme/network `eip155:\d+`/asset/amount/`payTo`/`maxTimeoutSeconds`,
  amount `^\d+$` in base units), `payload` (free-form; example
  `{ "signature": "0x..." }`), and an untyped `extensions` object. Both return
  `paymentIdentifier` (nullable) and `paymentPayloadHash`; settle is
  "Idempotent per payment payload hash".
- **Bookkeeping:** `X402PaymentAttempt` records `paymentIdentifier`,
  `direction` (`InboundVerify`/`InboundSettle`/`OutboundPayment`), `status`
  (`PaymentRequired`/`Verified`/`Settled`/`Failed`/**`Replayed`**), and the
  settling `facilitator` (`self_hosted` wallet vs `remote` URL — Masumi can
  act as its own facilitator or delegate).
- **Advertisement:** registry agents of type `X402` advertise an
  `x402ResourcesUrl` — a self-hosted manifest ("e.g. `/.well-known/x402.json`:
  a JSON document listing this agent resources, each `{ resource, type
  (http|mcp), inputSchema?, outputSchema? }`"); payment stays **agent-level**
  via `supportedPaymentSources` (chain `EVM`, CAIP-2 `network`, scheme enum
  **`"Exact"` (capitalized — diverges from the lowercase wire value)**,
  `payTo`, `extra`), not per resource. Registry list filters accept an EVM
  `payTo`/`address` and CAIP-2 network ids.

**Inferred (not provable from the OpenAPI spec alone):** that Masumi
transports the identifier on the wire as
`extensions["payment-identifier"].info.id` — the spec's `extensions` maps are
untyped (`additionalProperties`), so the exact envelope is implementation
detail. The format equality with the upstream extension makes this the obvious
intent.

**Sources:**
- In-repo: `packages/masumi/spec/payment.openapi.json` (paths `/x402/pay`, `/x402/verify`, `/x402/settle`; schemas `X402PaymentAttempt`, `X402Network`, `X402Wallet`; registry `x402ResourcesUrl` and supported-payment-source blocks)
- In-repo: `packages/masumi/spec/SPEC_SOURCES.md` (snapshot provenance)
- https://github.com/coinbase/x402/blob/main/specs/extensions/payment_identifier.md

---

## Unresolved

Gaps that could not be established in this pass; candidates for follow-up
tickets:

1. **CDP facilitator capabilities are opaque:** `/platform/v2/x402/supported`
   returns `Unauthorized`, so the schemes/extensions the CDP facilitator
   actually verifies/settles (incl. whether it honors `payment-identifier`
   idempotency) could not be enumerated without a CDP API key.
2. **Masumi's wire envelope for the payment identifier:** whether it emits
   `extensions["payment-identifier"].info.id` verbatim (see §5) — the OpenAPI
   spec leaves `extensions` untyped; needs a captured request or the
   masumi-payment-service source.
3. **Masumi's version dialect:** examples pin `x402Version: 1` with v2-shaped
   bodies; which versions its endpoints accept/reject is not stated in the
   spec.
4. **Refund mechanics:** x402 core has none — `exact` settlement is a
   one-way push transfer; the only wild hint of refundability is
   `batch-settlement`'s `withdrawDelay: 86400` escrow-ish window (mechanics
   unread). Feeds the refund-policy discussion as "protocol gives nothing;
   policy must live above it".
5. **Bazaar listing lifecycle details:** the exact CDP config surface for
   `discoverable: true`, de-listing, and how non-CDP facilitators would feed
   the index were not exercised (docs-level only).
6. **Governance:** the v2 spec text points at `github.com/x402-foundation/x402`
   but the canonical repo is still `coinbase/x402` (verified); the foundation
   hand-over status is unclear.

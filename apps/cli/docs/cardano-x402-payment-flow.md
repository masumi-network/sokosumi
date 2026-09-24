# Cardano x402 payment flow for Sokosumi Coworkers

Status: design note for discussion

Date: 2026-09-24

Scope: explain how `@x402/cardano` could let a Coworker receive ADA through Sokosumi and from other x402 buyers. This note proposes a flow. It does not define an approved API contract.

Claims use provenance labels:

- [VERIFIED] Checked in this repository or an official source on 2026-09-24.
- [PROPOSED] Suggested product or implementation direction.
- [INFERRED] Derived from verified evidence, but not directly specified by a source.
- [OPEN] A decision the product owner has not made.
- [UNVERIFIED] The reviewed sources do not prove this claim.
- [CORRECTION, VERIFIED] A prior statement was wrong or unclear, with evidence for the correction.

## Proposed flow in one sentence

[PROPOSED] Keep the Coworker in its current deployment. Add a Cardano x402 protected resource to that deployment, then let Sokosumi and any compatible x402 client call the same resource.

[PROPOSED] Reuse the existing Coworker directory, workspace access, Task, and chat APIs. Add only the missing payment data and the link between a settled x402 payment and a Sokosumi Task.

## Correction: Coworker endpoints and listings already exist

[CORRECTION, VERIFIED] An earlier draft discussed a Coworker hosted endpoint and a listing route without first checking the existing Core API. That wording blurred two different systems.

[VERIFIED] Core has `GET /v1/coworkers`. Its `scope=available` mode lists Coworkers that are usable in the active workspace. Core also has Coworker profile, Task event, usage, and workspace access routes. [Coworker list route](../../core/src/routes/v1/coworkers/get.ts#L53) · [Workspace access API](../../core/src/routes/v1/coworkers/[id]/workspace-access/get.ts#L1)

[VERIFIED] `POST /v1/coworkers` exists, but its route requires platform admin authentication. A new Coworker starts with `isWhitelisted: false`. [Create route](../../core/src/routes/v1/coworkers/post.ts#L18) · [Create authorization and defaults](../../core/src/routes/v1/coworkers/post.ts#L77)

[VERIFIED] The Coworker record has `url` and `baseURL` fields. `baseURL` is documented as an OpenAI Responses API URL used for chat. The offer schema has service descriptions and sample outputs. Neither schema defines a typed x402 resource URL, Cardano price, asset, network, or `payTo` address. [Coworker schema](../../core/src/schemas/coworker.schema.ts#L82) · [Coworker record schema](../../core/src/schemas/coworker.schema.ts#L167)

[VERIFIED] `POST /v1/coworkers/me/usage` records usage by creating a negative Sokosumi credit transaction. It does not send ADA to a Coworker. [Usage route](../../core/src/routes/v1/coworkers/me/usage/post.ts#L91) · [Credit debit](../../core/src/routes/v1/coworkers/me/usage/post.ts#L154)

[VERIFIED] `POST /v1/tasks/{id}/events` accepts a Coworker-only `masumiPayment` payload for an on-chain Masumi charge. Core creates a Task payment claim for that flow. This is distinct from receiving an x402 payment at a Coworker's Cardano address. [Task event schema](../../core/src/routes/v1/tasks/[id]/events/schema.ts#L180) · [Task payment claim creation](../../core/src/routes/v1/tasks/[id]/events/post.ts#L432)

[VERIFIED] The Core routes linked here expose x402 buying and Masumi Task payment claims. Those contracts do not expose a Coworker Cardano x402 seller receipt. The current catalog labels `cardano` as the MIP-003 hire rail and `x402` as the EVM pay rail. [Task x402 payment route](../../core/src/routes/v1/tasks/[id]/x402-payments/post.ts#L47) · [Agent catalog rails](../../core/src/routes/v1/agents/get.ts#L265)

[UNVERIFIED] I have not inspected the deployed Hermes or other Coworker host URLs. I cannot confirm whether any deployed Coworker already exposes an x402 seller resource.

In this note, **Coworker API** means Sokosumi Core routes for discovery, workspace access, chat, Tasks, and usage. **Coworker x402 resource** means an HTTP resource served by the agent deployment, or by an adapter connected to it. Core's Coworker list already exists. The payment resource and its payment contract remain to be built or verified.

## What `@x402/cardano` does

[VERIFIED] The upstream `@x402/cardano` package provides an x402 client, server, and facilitator scheme. The upstream pull request that added the TypeScript Cardano implementation is merged. [Package README](https://github.com/x402-foundation/x402/blob/main/typescript/packages/mechanisms/cardano/README.md) · [npm package](https://www.npmjs.com/package/%40x402/cardano) · [PR #2537](https://github.com/x402-foundation/x402/pull/2537)

| Part | Role in the flow |
| --- | --- |
| Client scheme | Uses a supplied Cardano signer to build and sign the payment transaction. It does not broadcast. A browser wallet can provide a CIP-30 signer. |
| Server scheme | Declares the protected resource price, network, and seller `payTo` address. It returns payment requirements when a request has no valid payment. |
| Facilitator scheme | Verifies the signed transaction, broadcasts it, and reports settlement evidence. The facilitator does not need ADA to pay transaction fees. |

[VERIFIED] The default `exact` transfer method pays a Cardano address. The buyer's signed transaction sends the selected asset to the seller's `payTo` address. For ADA, the asset is `lovelace`, and amounts use raw lovelace units. The registered network names are `cardano:mainnet`, `cardano:preprod`, and `cardano:preview`. [Asset and network details](https://github.com/x402-foundation/x402/blob/main/typescript/packages/mechanisms/cardano/README.md#networks)

[VERIFIED] The SDK does not create or custody a seller wallet. The seller or Coworker owner must supply the receiving address. The buyer needs a signer and funds for the amount and network fee.

[VERIFIED] The client signs but does not submit. The facilitator verifies the signed transaction, the protected resource handler runs, and `settle()` broadcasts the signed bytes. The default settlement policy asks for one newer L1 block. The facilitator can report `settlement_pending` when it has not observed enough evidence. [Confirmation policy](https://github.com/x402-foundation/x402/blob/main/typescript/packages/mechanisms/cardano/README.md#confirmation-policy) · [Pending settlement](https://github.com/x402-foundation/x402/blob/main/typescript/packages/mechanisms/cardano/README.md#settlement-and-settlement_pending)

[INFERRED] Since the resource handler runs before settlement completes, the handler must avoid repeating expensive work when the same signed payment is retried. Sokosumi should not show a payment as settled until it receives evidence that meets its chosen confirmation policy.

## Flow A: a buyer pays through Sokosumi

[PROPOSED] Sokosumi remains the discovery, Task, and chat surface. The buyer signs the x402 payment with a Cardano wallet. The agent deployment receives the payment directly at its configured `payTo` address.

```text
Buyer          Sokosumi Core/Web       Coworker x402 resource       Facilitator       Cardano
  |                    |                         |                       |                |
  |-- list coworkers ->|                         |                       |                |
  |<-- current list ---|                         |                       |                |
  |-- choose offer --->|                         |                       |                |
  |                    |-- create Task/payment intent (proposed)         |                |
  |                    |                         |                       |                |
  |-- request service -------------------------->|                       |                |
  |<-- 402: price, network, asset, payTo --------|                       |                |
  |-- sign with Cardano wallet                   |                       |                |
  |-- retry + PAYMENT-SIGNATURE ---------------->|-- verify ------------>|                |
  |                    |                         |<-- valid -------------|                |
  |                    |                         |-- run service         |                |
  |                    |                         |-- settle ------------>|-- broadcast -->|
  |                    |                         |<-- settlement evidence|<-- evidence ---|
  |<-- service result/status --------------------|                       |                |
  |                    |<-- receipt callback (proposed) -|                |                |
  |<-- Task payment state                         |                       |                |
```

[PROPOSED] Reuse the existing Coworker list and Task APIs. Add an approved Cardano payment contract for each paid offer. It must resolve to a resource URL, network, asset, amount, seller address, and price version. The buyer's signed payment and the facilitator's settlement evidence must link to the selected Coworker and Task.

[OPEN] The current API does not define this payment contract or a seller receipt callback. Decide whether Sokosumi Web calls the Coworker resource directly, or Core proxies that request. Either choice must preserve the x402 payment and its settlement evidence.

[PROPOSED] Store a payment state against the Task. At minimum, distinguish `requested`, `verified`, `settled`, `settlement_pending`, and `failed`. Use the Cardano transaction ID as an idempotency key. Do not treat the Task's existing usage charge or Masumi payment claim as an x402 receipt.

## Flow B: a buyer pays the Coworker outside Sokosumi

[PROPOSED] Publish the same x402 resource URL for other Cardano x402 clients. Direct buyers use the seller's resource and price terms. They do not need a Sokosumi account or Task.

```text
External x402 client        Coworker x402 resource        Facilitator        Cardano
        |                              |                       |                 |
        |-- request resource -------->|                       |                 |
        |<-- 402 payment terms -------|                       |                 |
        |-- sign with wallet          |                       |                 |
        |-- retry + PAYMENT-SIGNATURE>|-- verify ------------>|                 |
        |                              |<-- valid -------------|                 |
        |                              |-- run service         |                 |
        |                              |-- settle ------------>|-- broadcast -->|
        |<-- result / payment status -|<-- evidence ---------|<-- evidence ---|
```

[INFERRED] Sokosumi cannot show or reconcile an outside sale unless the Coworker reports a receipt through a future authenticated contract. The external x402 payment can still reach the seller's address without that report.

## How this differs from MPS

[VERIFIED] MPS means Masumi Payment Service. Its `POST /payment/x402` endpoint builds an unsigned Cardano funds-locking transaction for an existing MPS payment request. The buyer signs and submits the returned transaction. This API is an MPS payment operation. Its existence does not show that the upstream x402 facilitator or Coworker seller flow is already integrated. [MPS OpenAPI snapshot](../../../packages/masumi/spec/payment.openapi.json#L18661) · [Snapshot source](../../../packages/masumi/spec/SPEC_SOURCES.md#L22)

[VERIFIED] The SDK also has a `masumi` transfer method for a `vested_pay` escrow. Its README says its seller signature differs from the one the MPS node expects. A lock created by the SDK's `masumi` method cannot be driven through a `masumi-payment-service` node. [SDK and MPS compatibility](https://github.com/x402-foundation/x402/blob/main/typescript/packages/mechanisms/cardano/README.md#relationship-to-masumi-payment-service)

[PROPOSED] Use the SDK's `default` address-to-address transfer for a Coworker that receives standard ADA x402 payments. Keep MPS payment claims for Masumi Agent payment lifecycles. Do not route standard Coworker receipts through MPS unless a separate compatibility decision proves the complete flow.

## MVP sequence

1. [PROPOSED] Add the upstream Cardano server scheme to one supported Coworker deployment. Start with `cardano:preprod`, `lovelace`, and a direct seller `payTo` address.
2. [PROPOSED] Add typed payment terms to a Coworker offer or a linked payment profile. Do not reuse `baseURL`; it is the chat API URL.
3. [PROPOSED] Let Sokosumi buyers use the existing Coworker list and create a Task-linked payment intent. Add the signed payment and settlement receipt link to the Task flow.
4. [PROPOSED] Test retries, duplicate requests, failed settlement, and `settlement_pending` before enabling a mainnet offer.
5. [PROPOSED] Publish the same resource URL for outside x402 buyers. Add an authenticated receipt report only if Sokosumi needs to reconcile those sales.

[VERIFIED] The facilitator's default duplicate-settlement store is in process memory. The SDK README recommends a shared atomic store when several facilitator replicas may receive retries. Keep one facilitator instance for the first test, or configure shared storage before multi-replica use. [Duplicate settlement guard](https://github.com/x402-foundation/x402/blob/main/typescript/packages/mechanisms/cardano/README.md#duplicate-settlement-guard)

## Least confident decisions

1. [OPEN] Whether Sokosumi Web calls a Coworker x402 resource directly or Core proxies the paid request.
2. [OPEN] Which existing Task event or new payment record should store the x402 transaction ID and settlement evidence.
3. [OPEN] Which Cardano wallet signer Sokosumi supports first, and which confirmation policy marks a payment as settled.
4. [OPEN] Whether outside x402 sales need a Sokosumi receipt callback for vendor reporting or global Coworker review.

# Cardano payments for Sokosumi Coworkers

Status: proposed design

Date: 2026-09-24

Scope: choose a payment path for the Sokosumi Coworker MVP and document the later standard x402 path. This is not an approved API contract.

Claims use provenance labels:

- [VERIFIED] Checked in this repository, the inspected MPS clone, or an official source on 2026-09-24.
- [REPORTED] Stated by the user or another source that was not independently checked.
- [PROPOSED] Suggested product or implementation direction.
- [INFERRED] Derived from verified evidence, but not directly specified by a source.
- [OPEN] A decision that still needs product or engineering review.
- [CORRECTION, VERIFIED] An earlier statement was wrong or unclear, with evidence for the correction.

## Recommendation

[PROPOSED] For the Sokosumi-only MVP, reuse Sokosumi's existing Masumi Task payment claim and MPS purchase flow. Do not add another Cardano escrow implementation.

[PROPOSED] For standard x402 payments from outside buyers, add a Sokosumi-owned resource later. Use `@x402/cardano` with the `exact` scheme and `default` transfer method. It sends funds to the Coworker's `payTo` address and does not use MPS escrow.

[REPORTED] The agent runtime can stay on its current host. The plugin registers it as a Sokosumi Coworker. Sokosumi owns the Coworker record, workspace access, Task, and payment route.

[CORRECTION, VERIFIED] An earlier draft listed MPS `POST /payment/x402` as a possible payment backend. Source review showed that it builds an unsigned transaction for an existing MPS payment request. It does not verify or settle a payment. The upstream SDK's `masumi` method also uses a seller signature that an MPS node rejects. [MPS endpoint contract](../../../packages/masumi/spec/payment.openapi.json#L18661) · [SDK and MPS compatibility](https://github.com/x402-foundation/x402/blob/main/typescript/packages/mechanisms/cardano/README.md#relationship-to-masumi-payment-service)

## What Sokosumi and MPS already do

[VERIFIED] MPS means Masumi Payment Service. Masumi docs describe MIP-003 as its escrow payment flow. They describe direct x402 as a separate transfer flow without escrow refunds. [Masumi x402 guide](https://www.masumi.network/dev/masumi/core-concepts/x402)

[VERIFIED] Core accepts a Coworker-only `masumiPayment` value on Task events. It calls the Task charge flow, creates a durable `TaskPaymentClaim`, and later calls `createPurchaseFromMasumiTaskPayment`. [Task event schema](../../core/src/routes/v1/tasks/[id]/events/schema.ts#L180) · [Claim creation](../../core/src/routes/v1/tasks/[id]/events/post.ts#L391) · [Claim processor](../../core/src/services/task-payment-claim.service.ts#L437)

[VERIFIED] The Sokosumi Masumi client sends that claim to MPS through `POST /purchase`. It does not call MPS `POST /payment/x402` in this path. [MPS client method](../../../packages/masumi/src/clients/masumi-payment.client.ts#L618)

[VERIFIED] MPS `POST /payment/x402` requires an existing `PaymentRequest`. Its API description says: “No state is saved. The returned CBOR must be signed by the buyer and submitted to the network.” The route comment says: “No DB writes, no state-changing on-chain submit.” The route returns `unsignedTxCbor` and `collateralReturnLovelace`. [MPS OpenAPI snapshot](../../../packages/masumi/spec/payment.openapi.json#L18661) · [MPS route at inspected clone commit](https://github.com/masumi-network/masumi-payment-service/blob/ce960265eac56b9d468173e052e64fa4c9e7a2f2/src/routes/api/payments/x402/index.ts#L35-L74)

[VERIFIED] The inspected MPS `payment-source-x402` facilitator imports `@x402/evm` and EVM wallet signers. It uses the EVM scheme. The Cardano `/payment/x402` route is a separate payment-request transaction builder. [MPS EVM facilitator at inspected clone commit](https://github.com/masumi-network/masumi-payment-service/blob/ce960265eac56b9d468173e052e64fa4c9e7a2f2/packages/payment-source-x402/src/facilitator.ts#L1-L8)

[VERIFIED] Sokosumi's generated MPS client includes `POST /payment/x402`, but the public `createPaymentClient` wrapper spreads the EVM x402 methods and the Masumi purchase methods. It does not expose a Cardano `/payment/x402` helper today. [Generated operation](../../../packages/masumi/src/clients/openapi/generated/payment/sdk.gen.ts#L647) · [Client composition](../../../packages/masumi/src/clients/masumi-payment.client.ts#L533)

[PROPOSED] If a later Sokosumi flow chooses MPS's custom Cardano builder, add a thin wrapper in the existing `@sokosumi/masumi` client and link its payment request to the Task. Reuse MPS's transaction builder. Do not present that custom flow as compatible with every upstream `@x402/cardano` client.

[VERIFIED] Core has Coworker list and workspace routes. `POST /v1/coworkers` exists but requires platform admin authentication. The current Coworker offer schema has no typed Cardano x402 price or recipient. [Coworker list](../../core/src/routes/v1/coworkers/get.ts#L53) · [Create route](../../core/src/routes/v1/coworkers/post.ts#L18) · [Offer schema](../../core/src/schemas/coworker.schema.ts#L82)

## MVP flow: Sokosumi Task with Masumi payment claim

[VERIFIED] The `masumiPayment` Task event is a Masumi credit charge. Core creates a payment claim in the same transaction as the event. A retry-safe processor then creates or resolves the MPS purchase. [Task event schema](../../core/src/routes/v1/tasks/[id]/events/schema.ts#L180) · [Claim processor](../../core/src/services/task-payment-claim.service.ts#L405)

```text
Sokosumi buyer       Sokosumi Core       Coworker runtime       MPS       Cardano
      |                    |                    |                 |            |
      |-- create Task ---->|                    |                 |            |
      |                    |-- run Task ------->|                 |            |
      |                    |<-- Task event with masumiPayment ----|            |
      |                    |-- charge Task credits               |            |
      |                    |-- save TaskPaymentClaim             |            |
      |                    |-- POST /purchase ------------------->|            |
      |                    |<-- MPS purchase id/state ------------|            |
      |<-- Task status ----|                    |                 |            |
```

[PROPOSED] Keep this path for the MVP's Sokosumi Task payments. The plugin should use existing Coworker and Task APIs. It should not build Cardano transactions or run another escrow state machine.

[OPEN] Confirm that the target existing agents can emit the current `masumiPayment` payload and that its MPS purchase lifecycle matches the product's expected seller payout. The route source proves the contract exists. It does not prove every agent runtime already supports it.

## Later flow: standard Cardano x402 through Sokosumi

[VERIFIED] The SDK supports `exact` client, server, and facilitator schemes. The `default` transfer pays the asset to `payTo`. The client signs the transaction. The facilitator verifies and broadcasts it. [SDK README](https://github.com/x402-foundation/x402/blob/main/typescript/packages/mechanisms/cardano/README.md)

[PROPOSED] Serve one Sokosumi resource per approved Coworker offer. Sokosumi buyers and outside x402 clients use that resource. The agent host does not need a public x402 endpoint.

[PROPOSED] This flow uses the SDK's direct transfer method. The diagram shows the proposed Sokosumi integration around the SDK's request, verify, settle, and confirmation steps.

```text
Buyer or x402 client     Sokosumi x402 service      Coworker runtime       Cardano
        |                         |                         |                 |
        |-- request resource ---->|                         |                 |
        |<-- 402 terms -----------|                         |                 |
        |-- sign and retry ------>|                         |                 |
        |                         |-- verify and settle --------------------->|
        |                         |<-- settlement evidence ------------------|
        |                         |-- create/link paid Task ->|                |
        |<-- Task id/status ------|<-- events and result -----|                |
```

[PROPOSED] Create a pending Task when Sokosumi accepts the signed payment. Dispatch work only after the facilitator meets the chosen settlement policy. The SDK runs the resource handler after verification and before settlement, so Core must not start costly work in that handler. [SDK confirmation flow](https://github.com/x402-foundation/x402/blob/main/typescript/packages/mechanisms/cardano/README.md#confirmation-policy)

[VERIFIED] The SDK's direct `default` transfer has no Masumi escrow lifecycle. The Masumi docs describe direct x402 as final after settlement, without refunds. The Coworker owner must supply a Cardano `payTo` address. [Masumi x402 guide](https://www.masumi.network/dev/masumi/core-concepts/x402) · [SDK transfer methods](https://github.com/x402-foundation/x402/blob/main/typescript/packages/mechanisms/cardano/README.md#asset-transfer-methods)

[PROPOSED] Store the x402 transaction id, Coworker, offer, Task, network, asset, amount, recipient, and settlement evidence. Use the transaction id for replay protection. Keep this receipt separate from `TaskPaymentClaim`, which tracks MPS purchases.

## Payment paths and ownership

| Path | Use | Payment owner | Fit |
| --- | --- | --- | --- |
| [VERIFIED] Existing Masumi Task claim | Sokosumi Task MVP | MPS purchase flow, linked by Core | Reuse current path. Requires the Coworker to provide `masumiPayment`. |
| [VERIFIED] MPS `POST /payment/x402` | MPS payment request | MPS transaction builder and payment request | Builds an escrow lock. It is not the upstream SDK's verify and settle contract. |
| [PROPOSED] SDK `exact/default` | Later standard x402 | Sokosumi resource and facilitator | Direct payment to `payTo`. No MPS escrow or refund flow. |
| [VERIFIED] SDK `exact/masumi` | x402 escrow | SDK's x402-aware escrow flow | Do not send this lock through MPS. Its seller signature differs. |

[PROPOSED] Keep MPS as the Cardano escrow owner for Masumi Task payments. Use the upstream SDK for standard direct x402 when Sokosumi adds public x402 offers. Do not build a second Masumi escrow contract or claim the current MPS endpoint is SDK-compatible.

## Smallest implementation sequence

1. [PROPOSED] Use the existing Coworker list and workspace APIs. Add only the missing self-service registration permission needed by the CLI. Current Coworker creation is admin-only.
2. [PROPOSED] Reuse the current Task event and `TaskPaymentClaim` path for agents that already produce `masumiPayment` data.
3. [PROPOSED] Add a Sokosumi-owned `@x402/cardano` direct resource after the MVP path works. Reuse Coworker and Task identity. Add only the x402 offer terms and receipt link that Core lacks.
4. [PROPOSED] Test the x402 path on Cardano preprod before listing any direct-payment offer on mainnet.

## Least confident decisions

1. [OPEN] Whether current Coworker runtimes can emit the `masumiPayment` payload without changes.
2. [OPEN] Whether a Sokosumi-only Task MVP should launch with MPS escrow before standard x402 is ready.
3. [OPEN] Which Cardano wallet signer the Sokosumi x402 checkout should support first.
4. [OPEN] Which settlement evidence should let Core dispatch paid work and mark the receipt settled.

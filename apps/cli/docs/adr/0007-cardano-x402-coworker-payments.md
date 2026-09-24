# ADR 0007: Cardano payments for Sokosumi Coworkers

- Status: Proposed
- Date: 2026-09-24
- Decision source: [REPORTED] The user wants existing agents to register as Sokosumi Coworkers, receive payments through Sokosumi, and later reach outside x402 buyers through Sokosumi.

## Context

[VERIFIED] Core accepts a Coworker-only `masumiPayment` Task event. It applies the Task charge, stores a durable `TaskPaymentClaim`, and sends the claim to MPS through `POST /purchase`. [Task event schema](../../../core/src/routes/v1/tasks/[id]/events/schema.ts#L180) · [Claim processor](../../../core/src/services/task-payment-claim.service.ts#L437) · [MPS client](../../../../packages/masumi/src/clients/masumi-payment.client.ts#L618)

[VERIFIED] MPS `POST /payment/x402` is a separate route. It builds an unsigned Cardano lock transaction for an existing MPS `PaymentRequest`. Its API description says: “No state is saved. The returned CBOR must be signed by the buyer and submitted to the network.” The route comment says: “No DB writes, no state-changing on-chain submit.” [MPS OpenAPI snapshot](../../../../packages/masumi/spec/payment.openapi.json#L18661) · [MPS route at inspected clone commit](https://github.com/masumi-network/masumi-payment-service/blob/ce960265eac56b9d468173e052e64fa4c9e7a2f2/src/routes/api/payments/x402/index.ts#L35-L74)

[VERIFIED] The inspected MPS `payment-source-x402` facilitator imports `@x402/evm` and EVM wallet signers. It uses the EVM scheme. The generated Sokosumi payment client knows the MPS Cardano route, but the current `createPaymentClient` wrapper does not expose it. [MPS EVM facilitator](https://github.com/masumi-network/masumi-payment-service/blob/ce960265eac56b9d468173e052e64fa4c9e7a2f2/packages/payment-source-x402/src/facilitator.ts#L1-L8) · [Generated Cardano operation](../../../../packages/masumi/src/clients/openapi/generated/payment/sdk.gen.ts#L647) · [Sokosumi client composition](../../../../packages/masumi/src/clients/masumi-payment.client.ts#L533)

[VERIFIED] The upstream `@x402/cardano` SDK supports direct `exact/default` transfers and a `masumi` escrow method. Its README says the `masumi` seller signature differs from the signature expected by an MPS node. MPS cannot drive an escrow lock created by that SDK method. [SDK README](https://github.com/x402-foundation/x402/blob/main/typescript/packages/mechanisms/cardano/README.md) · [SDK and MPS compatibility](https://github.com/x402-foundation/x402/blob/main/typescript/packages/mechanisms/cardano/README.md#relationship-to-masumi-payment-service)

[VERIFIED] Core has Coworker list and workspace routes. Coworker creation exists but requires platform admin authentication. The current offer schema has no typed Cardano x402 price or recipient. [Coworker list](../../../core/src/routes/v1/coworkers/get.ts#L53) · [Create route](../../../core/src/routes/v1/coworkers/post.ts#L18) · [Offer schema](../../../core/src/schemas/coworker.schema.ts#L82)

## Proposed decision

[PROPOSED] For the Sokosumi-only MVP, reuse the existing Task `masumiPayment` and `TaskPaymentClaim` path. Keep Cardano escrow and its lifecycle in MPS. Do not build another Masumi escrow contract or call MPS `POST /payment/x402` as if it were the standard SDK facilitator.

[PROPOSED] For later external x402 support, serve the public resource from Sokosumi and use the SDK's `exact/default` transfer. The Coworker owner supplies `payTo`. The transfer goes directly to that address and has no MPS escrow or refund lifecycle.

[PROPOSED] Use existing Coworker list and workspace APIs. Add only the self-service registration permission required by the CLI, plus the x402 offer terms and receipt-to-Task link when the standard x402 phase starts.

## Consequences

[INFERRED] The MVP reuses Sokosumi's existing durable claim, retry, and MPS purchase code. It does not require new Cardano transaction building in Core.

[INFERRED] Standard Cardano x402 remains a separate direct-payment rail. Its receipt must not be represented as a `TaskPaymentClaim`, because that model tracks MPS purchases.

[VERIFIED] The SDK runs the resource handler after verification and before settlement. Settlement may remain pending. Core must delay Coworker work until the facilitator reports evidence that meets the chosen policy. [SDK confirmation flow](https://github.com/x402-foundation/x402/blob/main/typescript/packages/mechanisms/cardano/README.md#confirmation-policy) · [Settlement pending](https://github.com/x402-foundation/x402/blob/main/typescript/packages/mechanisms/cardano/README.md#settlement-and-settlement_pending)

## Least confident decisions

1. [OPEN] Whether current Coworker runtimes can emit the existing `masumiPayment` payload.
2. [OPEN] Whether the MPS Task path meets the product's exact seller payout expectation for the MVP.
3. [OPEN] Whether outside x402 support can start with direct `payTo` transfers and no escrow refunds.
4. [OPEN] Which Core service should host the x402 server and facilitator schemes.

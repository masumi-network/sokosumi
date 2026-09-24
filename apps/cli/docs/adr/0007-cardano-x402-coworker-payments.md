# ADR 0007: Cardano payments for Sokosumi Coworkers

- Status: Proposed
- Date: 2026-09-24
- Decision source: [REPORTED] The user wants existing agents to register as Sokosumi Coworkers, receive payments through Sokosumi, and later reach outside x402 buyers through Sokosumi.

## Context

[VERIFIED] Core accepts a Coworker-only `masumiPayment` Task event. It applies the Task charge, stores a durable `TaskPaymentClaim`, and sends the claim to MPS through `POST /purchase`. [Task event schema](../../../core/src/routes/v1/tasks/[id]/events/schema.ts#L180) · [Claim processor](../../../core/src/services/task-payment-claim.service.ts#L437) · [MPS client](../../../../packages/masumi/src/clients/masumi-payment.client.ts#L618)

[VERIFIED] The existing `masumiPayment` event charges the Task owner's credits from the reported amounts, then creates an MPS purchase with the supplied Masumi agent and seller identity. This proves a Task-linked MPS purchase. It does not prove generic x402 receipt or payment into a Coworker's own wallet. [Task charge](../../../core/src/routes/v1/tasks/[id]/events/post.ts#L99) · [Purchase input](../../../../packages/masumi/src/clients/masumi-payment.client.ts#L86) · [Purchase builder](../../../../packages/masumi/src/clients/masumi-payment.client.ts#L302)

[VERIFIED] MPS `POST /payment/x402` is a Cardano transaction builder for an existing `PaymentRequest`. Its API says: “No state is saved” and “the returned CBOR must be signed by the buyer and submitted to the network.” It requires the request's `blockchainIdentifier` and the buyer's Cardano address. [MPS OpenAPI snapshot](../../../../packages/masumi/spec/payment.openapi.json#L18661) · [MPS route at inspected clone commit](https://github.com/masumi-network/masumi-payment-service/blob/ce960265eac56b9d468173e052e64fa4c9e7a2f2/src/routes/api/payments/x402/index.ts#L35-L74)

[VERIFIED] The inspected MPS `payment-source-x402` facilitator imports `@x402/evm` and EVM wallet signers. Sokosumi's generated API client includes `POST /payment/x402`, but `createPaymentClient` does not expose that Cardano operation. Its x402 helper handles EVM networks. [MPS EVM facilitator](https://github.com/masumi-network/masumi-payment-service/blob/ce960265eac56b9d468173e052e64fa4c9e7a2f2/packages/payment-source-x402/src/facilitator.ts#L1-L8) · [Generated Cardano operation](../../../../packages/masumi/src/clients/openapi/generated/payment/sdk.gen.ts#L652) · [Sokosumi client composition](../../../../packages/masumi/src/clients/masumi-payment.client.ts#L533) · [EVM x402 helper](../../../../packages/masumi/src/clients/masumi-payment-x402.ts#L4-L8)

[VERIFIED] Masumi's Cardano x402 method can route funds through the Masumi smart contract. The current `@x402/cardano` README says a lock from its `masumi` method “cannot be driven through a `masumi-payment-service` node” because the seller authorization differs. [Masumi x402 guide](https://www.masumi.network/dev/masumi/core-concepts/x402) · [SDK and MPS compatibility](https://www.npmjs.com/package/%40x402/cardano/v/2.27.0)

[VERIFIED] Core has Coworker list and workspace routes. Coworker creation exists but requires platform admin authentication. The current offer schema has no typed Cardano x402 price or recipient. [Coworker list](../../../core/src/routes/v1/coworkers/get.ts#L53) · [Create route](../../../core/src/routes/v1/coworkers/post.ts#L18) · [Offer schema](../../../core/src/schemas/coworker.schema.ts#L82)

[VERIFIED] Sokosumi's task x402 route pays a 402 response returned by a listed x402 agent. Its readiness checks cover EVM networks. It does not implement Cardano x402 seller receipt for a Coworker. [Task x402 route](../../../core/src/routes/v1/tasks/[id]/x402-payments/post.ts#L47) · [x402 readiness](../../../core/src/helpers/x402-readiness.ts#L28)

## Proposed decision

[REPORTED: user decision, 2026-09-24] Hackathon Coworker registration and Cardano payment tests use Sokosumi Preprod and Cardano Preprod. Keep Coworker registration on Preprod for this flow. Do not change the existing permission model or whitelist operation.

[REPORTED: user decision] A private workspace Coworker can be tested before public paid availability. Seller receipt is required for a Coworker seeking global paid availability. A platform admin reviews and approves the waitlist request. This does not change the existing whitelist control.

[PROPOSED] Keep the current Task `masumiPayment` and `TaskPaymentClaim` behavior for tasks that use its existing Masumi purchase contract. Do not present this path as generic x402 or proof that the Coworker receives payment into its own wallet. Keep Cardano escrow and its lifecycle in MPS. Do not build another Masumi escrow contract.

[PROPOSED] For later external x402 support, first test a Sokosumi adapter around MPS `POST /payment/x402` on Cardano Preprod. The endpoint builds a transaction for an existing MPS payment request, then the buyer signs and submits it. The adapter must provide the request identifier and buyer address, expose a compatible HTTP 402 response, and link the resulting MPS payment state to a Sokosumi Task.

[OPEN] The current `@x402/cardano` `exact/masumi` method has a seller-signature format that MPS rejects. The MPS builder's compatibility with standard x402 clients is not established. Do not claim SDK interoperability until a preprod test proves it.

[PROPOSED] Keep `exact/default` as a separate option only if product chooses direct-to-address payment without the MPS escrow lifecycle.

[PROPOSED] Keep this CLI work within the current registration and whitelist permissions. Do not add or change a permission path in this ADR. When Cardano x402 seller receipt is ready, add payment offer terms and a receipt-to-Task link through approved Sokosumi and MPS interfaces.

## Consequences

[INFERRED] The existing `TaskPaymentClaim` path reuses Sokosumi's durable claim, retry, and MPS purchase code. It does not require new Cardano transaction building in Core, but it does not establish Coworker-owned wallet receipt.

[INFERRED] The MPS Cardano builder is the smallest candidate for an x402 path that keeps payment state in Masumi. It does not provide the HTTP 402 adapter or Sokosumi Task link.

[VERIFIED] `TaskPaymentClaim` tracks the existing MPS `POST /purchase` path. [Claim processor](../../../core/src/services/task-payment-claim.service.ts#L437) · [MPS client](../../../../packages/masumi/src/clients/masumi-payment.client.ts#L618)

[PROPOSED] Do not reuse `TaskPaymentClaim` for a Cardano x402 builder transaction unless that flow also creates the MPS purchase that this claim represents.

[VERIFIED] The SDK runs the resource handler after verification and before settlement. Settlement may remain pending. Core must delay Coworker work until the facilitator reports evidence that meets the chosen policy. [SDK confirmation flow](https://github.com/x402-foundation/x402/blob/main/typescript/packages/mechanisms/cardano/README.md#confirmation-policy) · [Settlement pending](https://github.com/x402-foundation/x402/blob/main/typescript/packages/mechanisms/cardano/README.md#settlement-and-settlement_pending)

## Least confident decisions

1. [OPEN] Whether the existing MPS purchase created from `masumiPayment` pays the specific Coworker service being tested. The source shows the Task charge and purchase payload, but not a Coworker wallet receipt.
2. [OPEN] Whether MPS `/payment/x402` can fit a standard x402 request and signed retry. Its API requires an existing payment identifier and a buyer address.
3. [OPEN] How Sokosumi should connect the MPS payment state to a Coworker Task before it dispatches work.
4. [OPEN] Which Sokosumi service should host the x402 resource route and any facilitator role.

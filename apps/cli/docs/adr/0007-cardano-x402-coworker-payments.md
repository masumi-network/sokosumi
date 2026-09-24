# ADR 0007: Cardano x402 payments for Coworkers

- Status: Proposed
- Date: 2026-09-24
- Decision source: [REPORTED] User wants a Coworker to receive ADA through Sokosumi and from other x402 buyers.

## Context

[VERIFIED] The upstream `@x402/cardano` package has client, server, and facilitator schemes. The client signs a transaction but does not broadcast it. The facilitator verifies and broadcasts the signed transaction. The server declares the payment requirements for a protected resource. [SDK README](https://github.com/x402-foundation/x402/blob/main/typescript/packages/mechanisms/cardano/README.md) · [Merged PR #2537](https://github.com/x402-foundation/x402/pull/2537)

[CORRECTION, VERIFIED] An earlier draft called for a Coworker hosted endpoint and new listing route without first checking the existing Core API. Sokosumi already has Coworker listing, workspace access, Task event, and usage routes. No new Coworker directory route is needed for this payment flow. [Coworker list route](../../../core/src/routes/v1/coworkers/get.ts#L53) · [Task event route](../../../core/src/routes/v1/tasks/[id]/events/post.ts#L240)

[VERIFIED] The Core Coworker schema has a generic `url` and a `baseURL` used for OpenAI Responses chat. The offer schema has no typed x402 resource URL, Cardano price, asset, network, or seller `payTo` address. [Coworker schema](../../../core/src/schemas/coworker.schema.ts#L82) · [Coworker record schema](../../../core/src/schemas/coworker.schema.ts#L167)

[VERIFIED] The current public catalog labels `cardano` as the MIP-003 hire rail and `x402` as the EVM pay rail. The inspected Coworker x402 payment route handles a Coworker paying a listed x402 Agent. It does not receive a Coworker's Cardano seller payment. [Catalog rail definitions](../../../core/src/routes/v1/agents/get.ts#L265) · [Task x402 buyer route](../../../core/src/routes/v1/tasks/[id]/x402-payments/post.ts#L47)

[VERIFIED] MPS has `POST /payment/x402` for building an unsigned Cardano transaction for an existing MPS payment request. The SDK's `masumi` transfer method uses a seller signature the MPS node does not accept. These are separate contracts. [MPS endpoint](../../../../packages/masumi/spec/payment.openapi.json#L18661) · [SDK and MPS compatibility](https://github.com/x402-foundation/x402/blob/main/typescript/packages/mechanisms/cardano/README.md#relationship-to-masumi-payment-service)

## Options

| Option | Flow | Cost and limit |
| --- | --- | --- |
| Coworker service handles x402 | The Coworker deployment serves a Cardano x402 resource. Sokosumi and outside buyers use the same resource. | Needs typed listing terms and a trusted link between Sokosumi Tasks and settlement receipts. |
| Sokosumi proxies payment | Core or Web hosts the paid resource and calls the Coworker after payment. | Gives Sokosumi direct Task linkage. Adds payment proxy, availability, and settlement responsibilities. It does not provide outside buyers with a Coworker endpoint by itself. |
| MPS handles payment | Use MPS payment requests and its `/payment/x402` operation. | Uses the MPS payment lifecycle. Compatibility with the upstream SDK `masumi` seller signature is not proven and the README documents a mismatch. |

## Proposed decision

[PROPOSED] Use the Coworker's existing deployment, or a thin adapter connected to it, to serve a standard Cardano x402 resource. Use the upstream SDK's `default` exact transfer method for direct ADA payments to the seller's `payTo` address.

[PROPOSED] Let Sokosumi reuse its current Coworker directory and Task flows. The Sokosumi listing points to the same paid resource that outside x402 clients call. Do not add another Coworker list API.

[PROPOSED] Add typed payment terms and Task receipt binding before showing an offer as paid in Sokosumi. Store the transaction ID, Coworker, offer, Task, network, asset, amount, `payTo`, price version, and facilitator settlement evidence. Do not mark a Task payment settled before the selected confirmation policy passes.

[PROPOSED] Keep the buyer signer separate from the seller receiving address. The SDK does not create or custody a wallet. A Coworker owner supplies the seller address. A buyer signer authorizes each payment.

[PROPOSED] Keep MPS claims for Masumi Agent payment lifecycles. Do not use the SDK's `masumi` transfer method with an MPS node unless a future decision validates a compatible seller signature and the full result, refund, and dispute lifecycle.

## Consequences

[INFERRED] Sokosumi can reuse its current discovery and Task APIs, but a paid Coworker offer needs a typed Cardano payment contract. The current Coworker schema does not carry that contract.

[INFERRED] Direct seller settlement lets an outside x402 client pay the same Coworker resource. Sokosumi still needs a receipt link if it wants to report a Task payment or include an outside sale in vendor reporting.

[VERIFIED] The SDK's resource handler runs after verification but before settlement. Settlement may remain pending. A Coworker integration needs an idempotent service operation and a clear Task state for pending settlement. [SDK confirmation flow](https://github.com/x402-foundation/x402/blob/main/typescript/packages/mechanisms/cardano/README.md#confirmation-policy) · [Settlement pending](https://github.com/x402-foundation/x402/blob/main/typescript/packages/mechanisms/cardano/README.md#settlement-and-settlement_pending)

## Least confident decisions

1. [OPEN] Whether the Sokosumi buyer calls the Coworker resource directly or Core proxies the request.
2. [OPEN] Whether Core needs a new receipt endpoint or can bind the payment through an existing Task operation.
3. [OPEN] Which wallet signer and settlement confirmation policy the first release supports.
4. [OPEN] Whether Sokosumi charges a fee or records only a direct seller payment.

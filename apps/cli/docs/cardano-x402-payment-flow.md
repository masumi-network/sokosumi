# Cardano payments for Sokosumi Coworkers

Status: MPS-first direction accepted; payment and seller receipt contracts remain open

Date: 2026-09-24

Scope: define the MPS-first Sokosumi Coworker payment MVP, then record Cardano x402 through Sokosumi as later work. This is not an approved API contract.

Claims use provenance labels:

- [VERIFIED] Checked in this repository, the inspected MPS clone, or an official source on 2026-09-24.
- [REPORTED] Stated by the user or another source that was not independently checked.
- [PROPOSED] Suggested product or implementation direction.
- [INFERRED] Derived from verified evidence, but not directly specified by a source.
- [OPEN] A decision that still needs product or engineering review.
- [CORRECTION, VERIFIED] An earlier statement was wrong or unclear, with evidence for the correction.

## Hackathon scope

[REPORTED: user decision, 2026-09-24] Coworker registration and Cardano payment tests use Sokosumi Preprod and Cardano Preprod. On Mainnet, the Coworker Register action shows “Preprod only” and does not submit registration. This does not change permission checks or the admin-only whitelist operation.

[VERIFIED] The current CLI defaults to Mainnet and its `coworkers register` command has no Preprod guard. This document records the requested behavior; the CLI change remains separate. [Target resolver](../src/auth/config.ts#L178) · [Register command](../src/cli/commands/coworkers.ts#L183)

[REPORTED: user decision] The developer or Coworker submits a waitlist request. A Sokosumi platform admin approves it. No permission model or whitelist default changes are part of this CLI work.

[OPEN] A waitlist submission route or CLI command was not found in the checked Core, Web, or CLI source. The CLI handoff surface remains undetermined. Do not invent a Core permission endpoint here.

[CORRECTION, REPORTED: user clarification, 2026-09-24] An earlier draft proposed Vendor-admin Coworker creation on Preprod. User clarified that permissions remain unchanged and work outside the CLI belongs to the team. Current `POST /v1/coworkers` requires platform admin authentication. With current permissions, a platform admin must provision the Coworker record before an ordinary Vendor admin can finish setup. [Create route](../../core/src/routes/v1/coworkers/post.ts#L77-L80)

[VERIFIED: source only] The current create handler sets `isWhitelisted: false`. The Preprod deployment default was not checked.

[VERIFIED] Vendor admins can manage an existing Coworker, create its API key, and grant it access to a Workspace where they are a member. These routes do not create the Coworker record. [Management access](../../core/src/routes/v1/coworkers/coworker-management-access.ts#L24-L66) · [API key create](../../core/src/routes/v1/coworkers/[id]/api-keys/post.ts#L48-L55) · [Workspace grant](../../core/src/routes/v1/coworkers/[id]/workspace-access/post.ts#L48-L74)

[VERIFIED] The CLI does not call the workspace-access route yet. The current `coworkers register` command creates a Coworker but does not attach a selected Workspace. [CLI command](../src/cli/commands/coworkers.ts#L183)

```
[Existing hosted agent]
        |
        | Install Skill from apps/cli/skills/sokosumi
        | Skill installer does not install the CLI executable
        v
[CLI executable install path: OPEN]
        |
        | Owner browser approval flow: OPEN
        v
[Sokosumi Preprod]
        |
        | Current Core create permission: platform admin
        | Coworker starts isWhitelisted=false
        v
[Platform admin provisions Coworker under Vendor]
        |
        | Vendor admin selects existing Workspace
        | CLI grant support: not shipped yet
        | Existing API returns GRANTED for member Workspace
        v
[Private Coworker in selected Workspace]
        |
        | MPS-first Task payment test and wallet receipt proof
        v
[Platform admin waitlist review, later]
        |
        | Approval through existing admin process
        v
[Global listing, later]
```

[PROPOSED] Coworker registration on Mainnet shows “Preprod only” and submits no registration request. Other CLI commands remain network-configurable. The diagram records the current authorization dependency and target sequence. It does not claim remote approval, self-service Coworker creation, or waitlist submission is implemented.

## Decision and verification gate

[REPORTED: user decision, 2026-09-24] Use MPS first for Sokosumi Task payments. Keep payment initiation inside Sokosumi. Do not add another Cardano escrow implementation to the CLI or plugin.

[PROPOSED] First trace the current Sokosumi Task and MPS purchase flow on Preprod. Use it only if a controlled test proves receipt in the intended Coworker wallet. The current code records a Task credit debit and an MPS purchase ID. Neither proves seller receipt.

[OPEN] The current purchase payload and claim processor do not establish who funds the purchase or whether MPS pays the intended Coworker wallet. Ask the Core and MPS owners to confirm the smallest supported path if the Preprod trace shows a gap.

[REPORTED: source-only subagent audit] Read-only source searches of [Noodles](https://github.com/utxo-AG/noodles) at `060d5bd`, [Soupie](https://github.com/utxo-AG/soupie) at `f92f756`, and [CodePat](https://github.com/PatrickTobler/codepat) at `a6639e2` reported “No relevant code hits” for payment markers. The audit did not inspect live deployments or prove that those Coworkers receive no payments. Payment behavior remains not determined from that audit.

[REPORTED] The agent runtime can stay on its current host. The plugin and CLI configure it as a Sokosumi Coworker. Core owns the Coworker record, Workspace access, and Task. MPS owns its payment lifecycle. Coworker creation follows current Core permissions.

[CORRECTION, VERIFIED] An earlier draft ruled out MPS `POST /payment/x402` as an x402 path. That was too broad. The route is an x402-specific Cardano transaction builder for an existing MPS payment request. Its contract says “No state is saved” and “the returned CBOR must be signed by the buyer and submitted to the network.” It can be part of an MPS-backed x402 adapter, but Sokosumi has not verified standard SDK interoperability. [MPS endpoint contract](../../../packages/masumi/spec/payment.openapi.json#L18661) · [MPS route at inspected clone commit](https://github.com/masumi-network/masumi-payment-service/blob/ce960265eac56b9d468173e052e64fa4c9e7a2f2/src/routes/api/payments/x402/index.ts#L35-L74)

## What Sokosumi and MPS already do

[VERIFIED] MPS means Masumi Payment Service. Masumi docs describe MIP-003 as the Payment Service escrow flow. They also document Cardano x402's `assetTransferMethod: "masumi"`, which routes payment through the Masumi smart contract. [Masumi x402 guide](https://www.masumi.network/dev/masumi/core-concepts/x402)

[VERIFIED] Core accepts a Coworker-only `masumiPayment` value on Task events. It calls the Task charge flow, creates a durable `TaskPaymentClaim`, and later calls `createPurchaseFromMasumiTaskPayment`. [Task event schema](../../core/src/routes/v1/tasks/[id]/events/schema.ts#L180) · [Claim creation](../../core/src/routes/v1/tasks/[id]/events/post.ts#L391) · [Claim processor](../../core/src/services/task-payment-claim.service.ts#L437)

[VERIFIED] The Sokosumi Masumi client sends that claim to MPS through `POST /purchase`. It does not call MPS `POST /payment/x402` in this path. [MPS client method](../../../packages/masumi/src/clients/masumi-payment.client.ts#L618)

[VERIFIED] Core's separate Coworker usage route debits customer credits and records usage. It does not create a seller payout record. [Usage route](../../core/src/routes/v1/coworkers/me/usage/post.ts#L154-L201)

[VERIFIED] MPS `POST /payment/x402` requires an existing `PaymentRequest`, its `blockchainIdentifier`, and the buyer's Cardano address. It returns `unsignedTxCbor` and `collateralReturnLovelace`. The API says “No state is saved” and “the returned CBOR must be signed by the buyer and submitted to the network.” [MPS OpenAPI snapshot](../../../packages/masumi/spec/payment.openapi.json#L18661) · [MPS route at inspected clone commit](https://github.com/masumi-network/masumi-payment-service/blob/ce960265eac56b9d468173e052e64fa4c9e7a2f2/src/routes/api/payments/x402/index.ts#L35-L74)

[VERIFIED] Masumi says, “Your Masumi Node automatically monitors the smart contract for incoming payments.” A seller can receive a callback or poll `GET /payment` for the payment state. [Masumi Payments & Escrow](https://www.masumi.network/dev/masumi/core-concepts/payments)

[VERIFIED] The inspected MPS `payment-source-x402` facilitator imports `@x402/evm` and EVM wallet signers. The Cardano `/payment/x402` route is a separate payment-request transaction builder. [MPS EVM facilitator at inspected clone commit](https://github.com/masumi-network/masumi-payment-service/blob/ce960265eac56b9d468173e052e64fa4c9e7a2f2/packages/payment-source-x402/src/facilitator.ts#L1-L8)

[VERIFIED] Sokosumi's generated MPS client includes `POST /payment/x402`, but the public `createPaymentClient` wrapper does not expose it. The wrapper's x402 helper handles EVM networks. [Generated operation](../../../packages/masumi/src/clients/openapi/generated/payment/sdk.gen.ts#L652) · [Client composition](../../../packages/masumi/src/clients/masumi-payment.client.ts#L533) · [EVM x402 helper](../../../packages/masumi/src/clients/masumi-payment-x402.ts#L4-L8)

[INFERRED] MPS's Cardano builder can support an x402 flow only with an adapter. The route needs an existing payment request and buyer address. It leaves transaction signing and submission to the buyer.

[VERIFIED] Masumi's x402 guide says `assetTransferMethod: "masumi"` sends payments through the Masumi smart contract. The current upstream SDK README says its `masumi` lock “cannot be driven through a `masumi-payment-service` node” because the seller authorization differs. [Masumi x402 guide](https://www.masumi.network/dev/masumi/core-concepts/x402) · [SDK and MPS compatibility](https://www.npmjs.com/package/%40x402/cardano/v/2.27.0)

[VERIFIED] Core has Coworker list and workspace routes. `POST /v1/coworkers` exists but requires platform admin authentication. The current Coworker offer schema has no typed Cardano x402 price or recipient. [Coworker list](../../core/src/routes/v1/coworkers/get.ts#L53) · [Create route](../../core/src/routes/v1/coworkers/post.ts#L18) · [Offer schema](../../core/src/schemas/coworker.schema.ts#L82)

## Cardano x402 SDK flow after the MVP

[VERIFIED: upstream SDK README checked 2026-09-24] `@x402/cardano` provides a client, server, and facilitator. The client builds and signs a Cardano transaction but does not broadcast it. The facilitator verifies and broadcasts the signed transaction. The server declares the payment terms in an HTTP 402 response. [Cardano SDK README](https://github.com/x402-foundation/x402/blob/main/typescript/packages/mechanisms/cardano/README.md)

[VERIFIED] The SDK supports address-to-address `default` transfers and `masumi` escrow locks. Its current `masumi` seller authorization differs from the signature checked by the MPS node. A lock created by the SDK cannot use that MPS node for its result, refund, or dispute lifecycle. [SDK transfer methods and MPS relationship](https://github.com/x402-foundation/x402/blob/main/typescript/packages/mechanisms/cardano/README.md#relationship-to-masumi-payment-service) · [Masumi x402 guide](https://www.masumi.network/dev/masumi/core-concepts/x402)

[REPORTED: user decision, 2026-09-24] Route future Cardano x402 buyers through Sokosumi. Do not select a direct-to-wallet SDK path for the MPS-first MVP.

```
[Outside Cardano buyer]
        |
        | Request a Sokosumi Coworker resource
        v
[Sokosumi resource route]
        |
        | HTTP 402 with price, asset, network, payTo
        v
[Buyer x402 client]
        |
        | Build and sign transaction; do not broadcast
        v
[Buyer retries with signed payment]
        |
        v
[Sokosumi/MPS settlement adapter: OPEN]
        |
        | Verify, broadcast, and report required confirmation
        v
[Cardano Preprod]
        |
        | Link payment to Sokosumi Task
        v
[Coworker Task dispatch: wait for accepted settlement]
```

[OPEN] This protocol sketch does not prove that MPS can settle the SDK's payment. The resource handler runs after verification and before settlement. Define the confirmation rule before Sokosumi dispatches paid work. [SDK confirmation flow](https://github.com/x402-foundation/x402/blob/main/typescript/packages/mechanisms/cardano/README.md#confirmation-policy)

## MVP candidate: Sokosumi Task with MPS purchase

[VERIFIED] The `masumiPayment` Task event charges Task owner credits from its amount fields. Core creates a payment claim in the same transaction. A retry-safe processor then creates or resolves an MPS purchase with the supplied Masumi agent and seller identity. The source does not prove that Cardano funds reach the intended Coworker wallet. [Task event schema](../../core/src/routes/v1/tasks/[id]/events/schema.ts#L180) · [Task charge](../../core/src/routes/v1/tasks/[id]/events/post.ts#L99) · [Purchase builder](../../../packages/masumi/src/clients/masumi-payment.client.ts#L302) · [Claim processor](../../core/src/services/task-payment-claim.service.ts#L405)

```
[Sokosumi buyer]
      |
      | Create Task
      v
[Sokosumi Core]
      |
      | Dispatch Task
      v
[Coworker runtime]
      |
      | Task event: masumiPayment
      v
[Core task event transaction]
      +--> Charge Task credits
      +--> Create durable TaskPaymentClaim
                 |
                 | Retry-safe processing
                 v
          [Task payment claim processor]
                 |
                 | POST /purchase
                 v
          [Masumi Payment Service]
                 +--> Purchase id and state --> [Task payment claim processor]
                 |                                      |
                 |                                      +--> Persist purchase state --> [TaskPaymentClaim]
                 |
                 +--> Masumi escrow lifecycle --> [Cardano network]

[Sokosumi Core]
      |
      | Task status
      v
[Sokosumi buyer]

[OPEN] Prove the MPS seller payout reaches the Coworker's configured Cardano Preprod wallet.
```

[PROPOSED] Test this existing path first. Keep the plugin on existing Coworker and Task APIs. Do not count a credit debit, purchase ID, or Task completion as seller receipt. Do not build Cardano transactions or a second escrow state machine in the plugin.

[OPEN] Confirm that the target existing agents can emit the current `masumiPayment` payload and that its MPS purchase lifecycle matches the product's expected seller payout. The route source proves the contract exists. It does not prove every agent runtime already supports it.

## Candidate flow: outside x402 buyer with MPS escrow

[PROPOSED] After the MPS-first MVP, Sokosumi can test an x402 resource adapter that uses MPS's Cardano builder for an existing payment request. Test it on Cardano Preprod first. The buyer signs and submits the returned transaction. MPS then tracks the escrow payment. This diagram shows later work, not verified compatibility with a standard x402 client.

```
[Outside x402 buyer]
      |
      | Request Coworker resource
      v
[Sokosumi x402 adapter for an approved Coworker]
      |
      | POST /payment/x402
      | Existing request ID, Cardano Preprod, buyerAddress
      v
[MPS Cardano transaction builder]
      |
      | Unsigned CBOR
      v
[Sokosumi x402 adapter]
      |
      | Proposed 402 response, format open
      v
[Outside x402 buyer]
      |
      | Sign and submit transaction
      v
[Cardano Preprod]
      |
      | Escrow lock for existing request
      v
[MPS payment lifecycle]
      |
      | Payment state
      v
[Sokosumi x402 adapter]
      |
      | Link payment to Task
      v
[Sokosumi Core]
      |
      | Dispatch after funds lock
      v
[Coworker runtime]
      |
      | Task result
      v
[Sokosumi Core]
```

[OPEN] The MPS builder requires `blockchainIdentifier` and `buyerAddress`. The public x402 client contract for supplying these values is not determined. The 402 response shape and payment retry must pass an interoperability test before Sokosumi claims support for standard x402 clients. [MPS OpenAPI snapshot](../../../packages/masumi/spec/payment.openapi.json#L18661)

[PROPOSED] Link the MPS payment state to a Sokosumi Task and dispatch work after the funds reach the MPS escrow state. Keep this payment record distinct from `TaskPaymentClaim` unless the flow also creates the MPS purchase tracked by that claim.

[VERIFIED] `@x402/cardano` supports `exact/default`, which pays `payTo` directly without Masumi escrow. This SDK capability is not selected for the MPS-first MVP. [SDK transfer methods](https://github.com/x402-foundation/x402/blob/main/typescript/packages/mechanisms/cardano/README.md#asset-transfer-methods) · [Masumi x402 guide](https://www.masumi.network/dev/masumi/core-concepts/x402)

## Payment paths and ownership

| Path | Use | Payment owner | Fit |
| --- | --- | --- | --- |
| [VERIFIED] Existing Masumi Task claim | Sokosumi Task payment candidate | MPS purchase flow, linked by Core | Requires the Coworker to provide `masumiPayment`. Seller receipt still needs Preprod proof. |
| [VERIFIED] MPS `POST /payment/x402` | Existing MPS payment request | MPS builder and escrow lifecycle | Returns unsigned CBOR for the buyer to sign and submit. An x402 adapter and SDK compatibility test remain open. |
| [VERIFIED] SDK `exact/masumi` | x402 with Masumi escrow | SDK-aware escrow lifecycle | Uses Masumi's contract. Current SDK seller authorization is incompatible with the MPS node. |
| [VERIFIED, NOT SELECTED] SDK `exact/default` | SDK direct-transfer capability | Recipient set by `payTo` | Pays `payTo` directly. Does not use MPS escrow. Not part of the MPS-first MVP. |

[PROPOSED] Use MPS for the Sokosumi Task MVP. Test its existing Task purchase path for seller receipt before choosing another payment rail. Route later Cardano x402 buyers through Sokosumi and test SDK compatibility first.

## Small PR sequence

1. [PROPOSED] Keep Coworker registration on Sokosumi Preprod. Leave all Core permissions and whitelist operations unchanged in the CLI work.
2. [OPEN] Confirm whether platform-admin pre-provisioning is the intended path for Coworker records. Current Core rejects ordinary Vendor-admin create requests.
3. [PROPOSED] Add the CLI workspace selection and grant flow for an existing Coworker using existing Core routes. Report success only after `GRANTED`.
4. [PROPOSED] Trace one paid Sokosumi Task through MPS on Cardano Preprod. Verify seller receipt to the Coworker wallet. If the current purchase path cannot do this, ask Core/MPS owners to define their change.
5. [PROPOSED] Add the Hermes adapter around the supported Coworker and Task interfaces. Keep the Skill at `apps/cli/skills/sokosumi`; choose a separate CLI binary release path before promising one-command install.
6. [PROPOSED] Add waitlist request and admin review only after the existing submission surface is confirmed. This remains separate from global whitelist control.
7. [PROPOSED] Later, route Cardano x402 buyers through Sokosumi. Test MPS and `@x402/cardano` interoperability before adding an adapter. Do not use direct-to-wallet x402 for this MVP.

## Least confident decisions

1. [OPEN] Whether the current MPS purchase from `masumiPayment` pays the Coworker's intended wallet.
2. [OPEN] Whether platform-admin pre-provisioning is acceptable for the first CLI release under unchanged Core permissions.
3. [OPEN] How a remote hosted runtime receives owner approval and the `coworker_*` credential.
4. [OPEN] Whether MPS `POST /payment/x402` interoperates with the selected standard x402 clients.

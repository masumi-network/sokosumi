/**
 * The exact x402 options Soko can settle, plus the two free-form maps a 402
 * carries around them (`extra`, `extensions`).
 *
 * Split out of `payment-required.schema.ts` because both sides of the
 * normalizer need these and neither owns them: the wild-dialect reader
 * (`payment-required.wild.ts`) decides which offered entry is selectable, and
 * the node-shape schema decides what may be emitted. Keeping them in either
 * file would make the other import it and close a cycle.
 */

import { z } from "zod";

import {
  BOUNDED_MAP_MESSAGE,
  boundedMapCheck,
  X402_MAX_EIP712_DOMAIN_VALUE_LENGTH,
} from "./payment-required.limits.js";

/**
 * The ONLY `extra.assetTransferMethod` Soko forwards.
 *
 * In x402 v2 exact-EVM the field selects the signing primitive the wallet
 * uses (`eip3009`, `permit2`, `erc7710`), so leaving it unvalidated lets
 * attacker-authored data pick how Soko's managed wallet signs. Independently
 * of what the node does with it, Soko's own settlement bookkeeping
 * (`extractEip3009Authorization`, apps/core) reads an EIP-3009
 * `{ nonce, validBefore }` authorization out of the signed payload, so any
 * other method silently empties the phased-settlement records the future
 * expiry reconciler depends on. Anything else is refused pre-charge.
 *
 * Exact spelling only: the field appears nowhere in the pinned node spec
 * (`packages/masumi/spec/payment.openapi.json` types `extra` as a free-form
 * `additionalProperties` map), so no live 402 in scope sends it at all and
 * strictness costs nothing today.
 */
export const X402_SUPPORTED_ASSET_TRANSFER_METHOD = "eip3009";

/**
 * The ONLY x402 `scheme` Soko forwards.
 *
 * Same argument as `X402_SUPPORTED_ASSET_TRANSFER_METHOD`, and it applies
 * verbatim: `extractEip3009Authorization` (apps/core) reads an EIP-3009
 * `{ nonce, validBefore }` authorization out of the signed payload, so a
 * scheme with different settlement semantics silently empties the
 * phased-settlement records the expiry reconciler depends on. `upto` and
 * `batch-settlement` are real alternatives, not hypotheticals —
 * `batch-settlement` adds `receiverAuthorizer`/`withdrawDelay` and changes
 * when funds actually move — and a 402 declaring one with
 * `extra.assetTransferMethod` simply omitted passed every other check.
 *
 * Exact spelling only, and strictness costs nothing today: every dialect in
 * scope (research 001 §2) and every Soko-side fence already assumes `exact`.
 * An allowlist rather than a literal so adding a second supported scheme is
 * one line here plus the settlement bookkeeping that earns it.
 */
export const X402_SUPPORTED_SCHEMES = ["exact"] as const;

export type X402SupportedScheme = (typeof X402_SUPPORTED_SCHEMES)[number];

/** The 402's free-form `extensions` map, bounded like every other one. */
export const x402ExtensionsSchema = z
  .record(z.string(), z.unknown())
  .refine(boundedMapCheck, { message: BOUNDED_MAP_MESSAGE });

/**
 * `extra` stays LOOSE — it carries the EIP-712 domain (`name`, `version`) for
 * the signature plus scheme-specific keys (`batch-settlement` adds
 * `receiverAuthorizer`/`withdrawDelay`) — but the three keys that change how
 * the wallet signs are typed, and the transfer method is pinned.
 */
export const x402ExtraSchema = z
  .looseObject({
    name: z.string().max(X402_MAX_EIP712_DOMAIN_VALUE_LENGTH).optional(),
    version: z.string().max(X402_MAX_EIP712_DOMAIN_VALUE_LENGTH).optional(),
    assetTransferMethod: z
      .literal(X402_SUPPORTED_ASSET_TRANSFER_METHOD)
      .optional(),
  })
  .refine(boundedMapCheck, { message: BOUNDED_MAP_MESSAGE });

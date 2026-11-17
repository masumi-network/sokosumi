import { schnorr } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import type { Event } from "nostr-tools/pure";

/**
 * Owner attestation (NIP-OA): an agent's event carries
 * `["auth", <owner pubkey>, <conditions>, <owner signature>]`, the owner's
 * Schnorr signature over sha256("nostr:agent-auth:" + agent + ":" + conditions).
 * Buzz signs every agent this way, so the owner is provable from the agent's
 * own profile.
 */

const HEX_64 = /^[0-9a-f]{64}$/;
const HEX_128 = /^[0-9a-f]{128}$/;
const CLAUSE = /^(kind=(0|[1-9]\d*)|created_at[<>](0|[1-9]\d*))$/;

function conditionsHold(conditions: string, event: Event): boolean {
  if (conditions === "") return true;
  for (const clause of conditions.split("&")) {
    if (!CLAUSE.test(clause)) return false;
    if (clause.startsWith("kind=")) {
      const kind = Number(clause.slice(5));
      if (kind > 65_535 || event.kind !== kind) return false;
    } else {
      const bound = Number(clause.slice(11));
      if (bound > 4_294_967_295) return false;
      const holds =
        clause[10] === "<"
          ? event.created_at < bound
          : event.created_at > bound;
      if (!holds) return false;
    }
  }
  return true;
}

/** The owner an event's single `auth` tag proves, or null. */
export function attestedOwner(event: Event): string | null {
  const tags = event.tags.filter((tag) => tag[0] === "auth");
  if (tags.length !== 1) return null;
  if (!conditionsHold(tags[0][2] ?? "", event)) return null;
  return authTagOwner(event.pubkey, tags[0]);
}

/** The owner an `auth` tag names for `agentPubkey`, if its signature holds. */
export function authTagOwner(
  agentPubkey: string,
  tag: string[],
): string | null {
  if (tag.length !== 4 || tag[0] !== "auth") return null;
  const [, owner, conditions, signature] = tag;
  if (!HEX_64.test(owner) || !HEX_128.test(signature)) return null;
  if (owner === agentPubkey) return null;
  if (
    conditions !== "" &&
    !conditions.split("&").every((c) => CLAUSE.test(c))
  ) {
    return null;
  }
  const message = sha256(
    utf8ToBytes(`nostr:agent-auth:${agentPubkey}:${conditions}`),
  );
  try {
    return schnorr.verify(hexToBytes(signature), message, hexToBytes(owner))
      ? owner
      : null;
  } catch {
    return null;
  }
}

/** Signs an `auth` tag, as an owner's Buzz app does; for tests and tools. */
export function ownerAuthTag(
  ownerSecretKey: Uint8Array,
  agentPubkey: string,
  conditions = "",
): string[] {
  const message = sha256(
    utf8ToBytes(`nostr:agent-auth:${agentPubkey}:${conditions}`),
  );
  return [
    "auth",
    bytesToHex(schnorr.getPublicKey(ownerSecretKey)),
    conditions,
    bytesToHex(schnorr.sign(message, ownerSecretKey)),
  ];
}

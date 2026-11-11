import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
} from "nostr-tools/pure";
import { describe, expect, it } from "vitest";

import { attestedOwner, ownerAuthTag } from "./owner-attestation";

const owner = generateSecretKey();
const agent = generateSecretKey();
const agentPubkey = getPublicKey(agent);

function profile(tags: string[][], created_at = 1_800_000_000) {
  return finalizeEvent({ kind: 0, created_at, tags, content: "{}" }, agent);
}

describe("attestedOwner", () => {
  it("returns the owner whose signature the agent carries", () => {
    expect(attestedOwner(profile([ownerAuthTag(owner, agentPubkey)]))).toBe(
      getPublicKey(owner),
    );
  });

  it("rejects a tag signed for another agent, or by someone else", () => {
    const other = getPublicKey(generateSecretKey());
    expect(attestedOwner(profile([ownerAuthTag(owner, other)]))).toBeNull();
    const forged = ownerAuthTag(owner, agentPubkey);
    forged[1] = getPublicKey(generateSecretKey());
    expect(attestedOwner(profile([forged]))).toBeNull();
  });

  it("rejects two auth tags, self-ownership and unmet conditions", () => {
    const tag = ownerAuthTag(owner, agentPubkey);
    expect(attestedOwner(profile([tag, tag]))).toBeNull();
    expect(
      attestedOwner(profile([ownerAuthTag(agent, agentPubkey)])),
    ).toBeNull();
    expect(
      attestedOwner(profile([ownerAuthTag(owner, agentPubkey, "kind=9")])),
    ).toBeNull();
    expect(
      attestedOwner(
        profile([ownerAuthTag(owner, agentPubkey, "created_at<1700000000")]),
      ),
    ).toBeNull();
    expect(
      attestedOwner(
        profile([ownerAuthTag(owner, agentPubkey, "kind=0&created_at>1")]),
      ),
    ).toBe(getPublicKey(owner));
  });
});

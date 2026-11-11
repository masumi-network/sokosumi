import { createHash } from "node:crypto";
import { generateSecretKey, verifyEvent } from "nostr-tools/pure";
import { describe, expect, it, vi } from "vitest";

import {
  BuzzRelayRejectedError,
  nip98Header,
  publishSignedEvent,
  relayHttpOrigin,
  signEvent,
} from "./relay-client";
import { openSecret, sealSecret } from "./secret-box";

const secretKey = generateSecretKey();

describe("relayHttpOrigin", () => {
  it("maps ws to http and wss to https on the same host", () => {
    expect(relayHttpOrigin("ws://localhost:3400")).toBe(
      "http://localhost:3400",
    );
    expect(relayHttpOrigin("wss://acme.chat.example.com/")).toBe(
      "https://acme.chat.example.com",
    );
  });
});

describe("nip98Header", () => {
  it("signs the url, method and the exact body's hash", () => {
    const body = '{"a":1}';
    const header = nip98Header({
      secretKey,
      url: "http://relay/events",
      method: "post",
      body,
    });
    const proof = JSON.parse(
      Buffer.from(header.slice("Nostr ".length), "base64").toString("utf8"),
    );
    expect(verifyEvent(proof)).toBe(true);
    expect(proof.kind).toBe(27235);
    expect(proof.tags).toEqual([
      ["u", "http://relay/events"],
      ["method", "POST"],
      ["nonce", expect.stringMatching(/^[0-9a-f]{32}$/)],
      ["payload", createHash("sha256").update(body).digest("hex")],
    ]);
  });

  it("never signs two requests the same, so the relay does not take one for a replay", () => {
    const input = {
      secretKey,
      url: "http://relay/api/invites",
      method: "POST",
      body: "{}",
    };
    expect(nip98Header(input)).not.toBe(nip98Header(input));
  });
});

describe("publishSignedEvent", () => {
  const event = signEvent({ kind: 9, tags: [], content: "hi" }, secretKey);
  const respond = (status: number, body: unknown) =>
    vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify(body), { status }),
      ) as unknown as typeof fetch;

  it("resolves when the relay accepts or already has the event", async () => {
    await expect(
      publishSignedEvent({
        relayUrl: "ws://relay",
        event,
        secretKey,
        fetchImpl: respond(200, { accepted: true }),
      }),
    ).resolves.toMatchObject({ eventId: event.id });
    await expect(
      publishSignedEvent({
        relayUrl: "ws://relay",
        event,
        secretKey,
        fetchImpl: respond(200, { accepted: false, message: "duplicate: x" }),
      }),
    ).resolves.toMatchObject({ eventId: event.id });
  });

  it("throws the relay's reason when it refuses", async () => {
    await expect(
      publishSignedEvent({
        relayUrl: "ws://relay",
        event,
        secretKey,
        fetchImpl: respond(400, { accepted: false, message: "invalid: nope" }),
      }),
    ).rejects.toEqual(new BuzzRelayRejectedError(9, "invalid: nope"));
  });
});

describe("secret box", () => {
  it("opens what it sealed and refuses a tampered or wrong-key box", () => {
    const sealed = sealSecret("nsec-ish", "s".repeat(32));
    expect(openSecret(sealed, "s".repeat(32))).toBe("nsec-ish");
    expect(() => openSecret(sealed, "t".repeat(32))).toThrow();
    const [v, iv, tag, body] = sealed.split(".");
    const flipped = `${v}.${iv}.${tag}.${body.slice(0, -2)}AA`;
    expect(() => openSecret(flipped, "s".repeat(32))).toThrow();
  });
});

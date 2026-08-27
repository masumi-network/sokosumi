import assert from "node:assert/strict";

import { describe, it } from "vitest";

import type { Prisma, UTMAttribution } from "../generated/prisma/client.js";
import type { UTMData } from "../types/utm.js";
import { utmAttributionRepository } from "./utmAttribution.repository.js";

const USER_ID = "user_123";
const CAPTURED_AT = "2026-02-20T08:00:00.000Z";

function validUtmData(): UTMData {
  return {
    utm_source: "google",
    utm_medium: "cpc",
    utm_campaign: "spring_launch",
    utm_term: "ai agents",
    utm_content: "hero_cta",
    referrer: "https://example.com",
    landingPage: "https://sokosumi.com/",
    capturedAt: CAPTURED_AT,
  };
}

function createTx(returnValue: UTMAttribution | null) {
  let upsertCall: { where?: unknown; create?: unknown; update?: unknown } = {};
  const tx = {
    uTMAttribution: {
      upsert: async (args: typeof upsertCall) => {
        upsertCall = args;
        return returnValue;
      },
    },
  } as unknown as Prisma.TransactionClient;

  return { tx, getUpsertCall: () => upsertCall };
}

describe("utmAttributionRepository.createUTMAttribution", () => {
  it("upserts keyed on the unique userId so repeated conversions don't conflict", async () => {
    const row = {
      id: "attr-1",
      convertedAt: new Date("2026-02-20T09:05:00.000Z"),
    } as UTMAttribution;
    const { tx, getUpsertCall } = createTx(row);

    const result = await utmAttributionRepository.createUTMAttribution(
      USER_ID,
      validUtmData(),
      tx,
    );

    assert.equal(result, row);

    const call = getUpsertCall();
    assert.deepEqual(call.where, { userId: USER_ID });
  });

  it("maps UTM fields and coerces capturedAt to a Date on create and update", async () => {
    const { tx, getUpsertCall } = createTx({
      id: "attr-1",
    } as UTMAttribution);

    await utmAttributionRepository.createUTMAttribution(
      USER_ID,
      validUtmData(),
      tx,
    );

    const call = getUpsertCall() as {
      create: {
        user: { connect: { id: string } };
        utmSource: string;
        landingPage?: string;
        capturedAt: Date;
        convertedAt: Date;
      };
      update: {
        utmSource: string;
        capturedAt: Date;
        convertedAt: Date;
        // `update` must not re-connect the user relation.
        user?: unknown;
      };
    };

    // create branch connects the user and stores the mapped fields
    assert.deepEqual(call.create.user, { connect: { id: USER_ID } });
    assert.equal(call.create.utmSource, "google");
    assert.equal(call.create.landingPage, "https://sokosumi.com/");
    assert.ok(call.create.capturedAt instanceof Date);
    assert.equal(call.create.capturedAt.toISOString(), CAPTURED_AT);
    assert.ok(call.create.convertedAt instanceof Date);

    // update branch refreshes the data without touching the user relation
    assert.equal(call.update.user, undefined);
    assert.equal(call.update.utmSource, "google");
    assert.ok(call.update.capturedAt instanceof Date);
    assert.equal(call.update.capturedAt.toISOString(), CAPTURED_AT);
    assert.ok(call.update.convertedAt instanceof Date);
  });

  it("returns null when the write fails", async () => {
    const { tx } = createTx(null);

    const result = await utmAttributionRepository.createUTMAttribution(
      USER_ID,
      validUtmData(),
      tx,
    );

    assert.equal(result, null);
  });
});

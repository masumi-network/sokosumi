import assert from "node:assert/strict";
import { describe, it } from "vitest";

import {
  applyMicrosoftRefreshToAccount,
  assertIdentitiesReadyForUniqueIndex,
  decodeJwtPayload,
  isHarvestReportOnly,
  resolveAccountIdentity,
} from "../better-auth-1-7-account-identity.js";

function jwtWithPayload(payload: Record<string, unknown>): string {
  const header = Buffer.from(
    JSON.stringify({ alg: "none", typ: "JWT" }),
  ).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.`;
}

const readyMicrosoftIdToken = jwtWithPayload({
  oid: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  iss: "https://login.microsoftonline.com/tenant-1/v2.0",
  sub: "pairwise-sub",
});

describe("resolveAccountIdentity", () => {
  it("maps credential accounts to local:credential and the user id", () => {
    const identity = resolveAccountIdentity({
      id: "acc-1",
      providerId: "credential",
      accountId: "user-1",
      userId: "user-1",
    });

    assert.deepEqual(identity, {
      status: "ready",
      id: "acc-1",
      issuer: "local:credential",
      accountId: "user-1",
      source: "credential",
    });
  });

  it("uses the Google OpenID issuer and keeps the existing accountId", () => {
    const identity = resolveAccountIdentity({
      id: "acc-g",
      providerId: "google",
      accountId: "google-sub-1",
      userId: "user-1",
    });

    assert.deepEqual(identity, {
      status: "ready",
      id: "acc-g",
      issuer: "https://accounts.google.com",
      accountId: "google-sub-1",
      source: "google",
    });
  });

  it("takes Microsoft oid and iss from a stored id token", () => {
    const identity = resolveAccountIdentity({
      id: "acc-m",
      providerId: "microsoft",
      accountId: "pairwise-sub",
      userId: "user-1",
      idToken: readyMicrosoftIdToken,
    });

    assert.deepEqual(identity, {
      status: "ready",
      id: "acc-m",
      issuer: "https://login.microsoftonline.com/tenant-1/v2.0",
      accountId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      source: "microsoft-id-token",
    });
  });

  it("does not invent a Microsoft oid when the id token is missing", () => {
    const identity = resolveAccountIdentity({
      id: "acc-m",
      providerId: "microsoft",
      accountId: "pairwise-sub",
      userId: "user-1",
    });

    assert.deepEqual(identity, {
      status: "unmapped",
      id: "acc-m",
      providerId: "microsoft",
      accountId: "pairwise-sub",
      reason: "microsoft-id-token-missing",
    });
  });
});

describe("applyMicrosoftRefreshToAccount", () => {
  const row = {
    id: "acc-m",
    providerId: "microsoft",
    accountId: "pairwise-sub",
    userId: "user-1",
    refreshToken: "old-refresh",
  };

  it("writes id token and rotated refresh token when oid is present", () => {
    assert.deepEqual(
      applyMicrosoftRefreshToAccount(row, {
        idToken: readyMicrosoftIdToken,
        refreshToken: "new-refresh",
      }),
      {
        idToken: readyMicrosoftIdToken,
        refreshToken: "new-refresh",
      },
    );
  });

  it("keeps the previous refresh token when Microsoft omits a new one", () => {
    assert.deepEqual(
      applyMicrosoftRefreshToAccount(row, {
        idToken: readyMicrosoftIdToken,
      }),
      {
        idToken: readyMicrosoftIdToken,
        refreshToken: "old-refresh",
      },
    );
  });

  it("does not write when the new id token still has no oid", () => {
    assert.equal(
      applyMicrosoftRefreshToAccount(row, {
        idToken: jwtWithPayload({
          iss: "https://login.microsoftonline.com/tenant-1/v2.0",
          sub: "pairwise-sub",
        }),
        refreshToken: "new-refresh",
      }),
      null,
    );
  });
});

describe("isHarvestReportOnly", () => {
  it("is off by default and on with --report-only", () => {
    assert.equal(isHarvestReportOnly(["tsx", "script.ts"]), false);
    assert.equal(
      isHarvestReportOnly(["tsx", "script.ts", "--report-only"]),
      true,
    );
  });
});

describe("decodeJwtPayload", () => {
  it("reads claims from a compact JWT", () => {
    const token = jwtWithPayload({ oid: "oid-1", iss: "https://example" });
    assert.deepEqual(decodeJwtPayload(token), {
      oid: "oid-1",
      iss: "https://example",
    });
  });
});

describe("assertIdentitiesReadyForUniqueIndex", () => {
  it("rejects leftover unmapped Microsoft rows", () => {
    assert.throws(
      () =>
        assertIdentitiesReadyForUniqueIndex([
          {
            status: "unmapped",
            id: "acc-m",
            providerId: "microsoft",
            accountId: "pairwise-sub",
            reason: "microsoft-id-token-missing",
          },
        ]),
      /unmapped account identities/,
    );
  });

  it("rejects issuer and accountId collisions", () => {
    assert.throws(
      () =>
        assertIdentitiesReadyForUniqueIndex([
          {
            status: "ready",
            id: "a",
            issuer: "https://accounts.google.com",
            accountId: "same-sub",
            source: "google",
          },
          {
            status: "ready",
            id: "b",
            issuer: "https://accounts.google.com",
            accountId: "same-sub",
            source: "google",
          },
        ]),
      /identity collisions/,
    );
  });
});

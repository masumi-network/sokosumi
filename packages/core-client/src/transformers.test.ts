import { describe, expect, it } from "vitest";

import { postProjectsByIdAdsConnectionsFinalizeResponseTransformer } from "./generated/transformers.gen.js";

const meta = { timestamp: "2026-10-01T00:00:00.000Z" };

describe("generated response transformers keep nullable objects null-safe", () => {
  it("finalize ad connection: connection null (account reaches no ad accounts)", async () => {
    const result =
      await postProjectsByIdAdsConnectionsFinalizeResponseTransformer({
        data: { connection: null, availableAccounts: [] },
        meta,
      });

    expect(result.data.connection).toBeNull();
    expect(result.meta.timestamp).toBeInstanceOf(Date);
  });

  it("finalize ad connection: connection present has its date revived", async () => {
    const result =
      await postProjectsByIdAdsConnectionsFinalizeResponseTransformer({
        data: {
          connection: {
            id: "cccccccc-cccc-4ccc-cccc-cccccccccccc",
            provider: "google_ads",
            status: "active",
            createdAt: "2026-10-01T00:00:00.000Z",
          },
          availableAccounts: [],
        },
        meta,
      });

    expect(result.data.connection?.createdAt).toBeInstanceOf(Date);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const zernioRequest = vi.hoisted(() => vi.fn());
vi.mock("@/clients/zernio.client", () => ({
  ZernioApiError: class ZernioApiError extends Error {},
  zernioRequest,
}));

import {
  createZernioIntent,
  zernioProofDigest,
} from "./zernio-tiktok-connection.service";

const PROFILE = "0123456789abcdef01234567";

describe("createZernioIntent", () => {
  beforeEach(() => {
    zernioRequest.mockReset();
    zernioRequest.mockResolvedValue({ profile: { _id: PROFILE } });
  });

  it("comes back to the caller's origin with the connection and a proof only Core can check", async () => {
    const intent = await createZernioIntent(
      "https://app.sokosumi.com",
      "TikTok",
    );
    const { origin, pathname, searchParams } = intent.callback;
    expect(origin + pathname).toBe("https://app.sokosumi.com/zernio/callback");
    expect([...searchParams.keys()]).toEqual(["connection", "proof"]);
    expect(searchParams.get("connection")).toBe(`zernio:${PROFILE}`);
    expect(zernioProofDigest(searchParams.get("proof") ?? "")).toBe(
      intent.authConfigId,
    );
  });

  it("keeps the Project CMO's return address names, and nothing else of it", async () => {
    const intent = await createZernioIntent(
      "https://app.cmo.xyz/connect/callback?from=app&project=project-2&proof=forged&next=https://evil.example",
      "LinkedIn",
    );
    const { origin, pathname, searchParams } = intent.callback;
    expect(origin + pathname).toBe("https://app.cmo.xyz/zernio/callback");
    expect(searchParams.get("project")).toBe("project-2");
    expect(searchParams.get("from")).toBe("app");
    expect(searchParams.has("next")).toBe(false);
    expect(searchParams.get("pendingDataOnly")).toBe("true");
    // The proof is Core's own, never the caller's.
    expect(searchParams.getAll("proof")).toHaveLength(1);
    expect(searchParams.get("proof")).not.toBe("forged");
  });
});
